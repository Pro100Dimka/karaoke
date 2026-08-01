// Karaoke Studio ASIO bridge (GPLv3 option of the Steinberg ASIO SDK).
//
// The bridge is intentionally a small, independent process.  ASIO drivers are
// vendor-native DLLs: isolating them keeps a driver failure from terminating
// the FastAPI backend or the Electron UI.
#include <windows.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <csignal>
#include <cstring>
#include <iostream>
#include <optional>
#include <sstream>
#include <string>
#include <vector>

#include "asiosys.h"
#include "asio.h"
#include "asiodrivers.h"

extern bool loadAsioDriver(char* name);

namespace {

constexpr long kMaxChannels = 2;
std::atomic_bool g_running{true};
std::atomic<float> g_rms{-120.0F};
std::atomic_bool g_clipping{false};
AsioDrivers* g_drivers = nullptr;

struct Options {
  std::string driver_name;
  long input_channel = 0;
  long output_channels = 2;
  long buffer_size = 0;
  double sample_rate = 0.0;
  bool list = false;
};

struct Engine {
  ASIODriverInfo info{};
  ASIOCallbacks callbacks{};
  ASIOBufferInfo buffers[kMaxChannels * 2]{};
  ASIOChannelInfo channels[kMaxChannels * 2]{};
  long input_count = 0;
  long output_count = 0;
  long buffer_size = 0;
  long input_latency = 0;
  long output_latency = 0;
  bool output_ready = false;
  bool buffers_created = false;
} g_engine;

void emit(const std::string& json) { std::cout << json << std::endl; }

std::string escape_json(const std::string& value) {
  std::string result;
  for (const char character : value) {
    if (character == '\\' || character == '"') result.push_back('\\');
    if (character == '\n') result += "\\n";
    else result.push_back(character);
  }
  return result;
}

std::optional<Options> parse_options(int argc, char** argv) {
  Options options;
  for (int index = 1; index < argc; ++index) {
    const std::string key = argv[index];
    if (key == "--list") options.list = true;
    else if (key == "--driver" && index + 1 < argc) options.driver_name = argv[++index];
    else if (key == "--input-channel" && index + 1 < argc) options.input_channel = std::stol(argv[++index]);
    else if (key == "--output-channels" && index + 1 < argc) options.output_channels = std::stol(argv[++index]);
    else if (key == "--buffer-size" && index + 1 < argc) options.buffer_size = std::stol(argv[++index]);
    else if (key == "--sample-rate" && index + 1 < argc) options.sample_rate = std::stod(argv[++index]);
    else return std::nullopt;
  }
  return options;
}

void __cdecl stop_handler(int) { g_running = false; }
BOOL WINAPI console_handler(DWORD signal) {
  if (signal == CTRL_C_EVENT || signal == CTRL_BREAK_EVENT || signal == CTRL_CLOSE_EVENT) {
    g_running = false;
    return TRUE;
  }
  return FALSE;
}

int bytes_per_sample(ASIOSampleType type) {
  switch (type) {
    case ASIOSTInt16LSB:
    case ASIOSTInt16MSB: return 2;
    case ASIOSTInt24LSB:
    case ASIOSTInt24MSB: return 3;
    case ASIOSTInt32LSB:
    case ASIOSTInt32MSB:
    case ASIOSTFloat32LSB:
    case ASIOSTFloat32MSB:
    case ASIOSTInt32LSB16:
    case ASIOSTInt32LSB18:
    case ASIOSTInt32LSB20:
    case ASIOSTInt32LSB24:
    case ASIOSTInt32MSB16:
    case ASIOSTInt32MSB18:
    case ASIOSTInt32MSB20:
    case ASIOSTInt32MSB24: return 4;
    case ASIOSTFloat64LSB:
    case ASIOSTFloat64MSB: return 8;
    default: return 0;
  }
}

float sample_peak(const void* source, ASIOSampleType type, long frames) {
  float peak = 0.0F;
  if (type == ASIOSTFloat32LSB) {
    const auto* values = static_cast<const float*>(source);
    for (long index = 0; index < frames; ++index) peak = std::max(peak, std::abs(values[index]));
  } else if (type == ASIOSTInt32LSB || type == ASIOSTInt32LSB24) {
    const auto* values = static_cast<const int32_t*>(source);
    for (long index = 0; index < frames; ++index) {
      peak = std::max(peak, static_cast<float>(std::abs(static_cast<double>(values[index])) / 2147483648.0));
    }
  } else if (type == ASIOSTInt16LSB) {
    const auto* values = static_cast<const int16_t*>(source);
    for (long index = 0; index < frames; ++index) peak = std::max(peak, std::abs(values[index] / 32768.0F));
  }
  return peak;
}

void process_buffer(long buffer_index) {
  if (g_engine.input_count < 1 || g_engine.output_count < 1) return;
  const void* input = g_engine.buffers[0].buffers[buffer_index];
  const ASIOSampleType input_type = g_engine.channels[0].type;
  const int input_bytes = bytes_per_sample(input_type);
  if (input == nullptr || input_bytes == 0) return;

  const float peak = sample_peak(input, input_type, g_engine.buffer_size);
  const float prior = std::pow(10.0F, g_rms.load() / 20.0F);
  const float smoothed = std::max(peak, prior * 0.88F);
  g_rms = smoothed > 0.0F ? 20.0F * std::log10(smoothed) : -120.0F;
  g_clipping = peak >= 0.99F;

  for (long output = 0; output < g_engine.output_count; ++output) {
    const long output_index = g_engine.input_count + output;
    void* target = g_engine.buffers[output_index].buffers[buffer_index];
    const ASIOSampleType output_type = g_engine.channels[output_index].type;
    if (target == nullptr) continue;
    if (output_type == input_type) {
      std::memcpy(target, input, static_cast<size_t>(g_engine.buffer_size * input_bytes));
    } else {
      std::memset(target, 0, static_cast<size_t>(g_engine.buffer_size * bytes_per_sample(output_type)));
    }
  }
  if (g_engine.output_ready) ASIOOutputReady();
}

void buffer_switch(long index, ASIOBool) { process_buffer(index); }
ASIOTime* buffer_switch_time_info(ASIOTime* time_info, long index, ASIOBool) {
  process_buffer(index);
  return time_info;
}
void sample_rate_changed(ASIOSampleRate) {}
long asio_message(long selector, long value, void*, double*) {
  if (selector == kAsioSelectorSupported) {
    return value == kAsioEngineVersion || value == kAsioSupportsTimeInfo || value == kAsioResetRequest;
  }
  if (selector == kAsioEngineVersion) return 2;
  if (selector == kAsioResetRequest) { g_running = false; return 1; }
  return 0;
}

long resolve_buffer_size(const Options& options, long minimum, long maximum, long preferred, long granularity) {
  if (options.buffer_size <= 0) return preferred;
  long size = std::clamp(options.buffer_size, minimum, maximum);
  if (granularity > 0) size = minimum + ((size - minimum) / granularity) * granularity;
  if (granularity == -1) { long power = 1; while (power < size) power <<= 1; size = power; }
  return std::clamp(size, minimum, maximum);
}

bool create_buffers(const Options& options) {
  long minimum = 0, maximum = 0, preferred = 0, granularity = 0;
  if (ASIOGetChannels(&g_engine.input_count, &g_engine.output_count) != ASE_OK || g_engine.input_count < 1 || g_engine.output_count < 1) return false;
  g_engine.input_count = 1;
  g_engine.output_count = std::min({options.output_channels, g_engine.output_count, kMaxChannels});
  if (ASIOGetBufferSize(&minimum, &maximum, &preferred, &granularity) != ASE_OK) return false;
  g_engine.buffer_size = resolve_buffer_size(options, minimum, maximum, preferred, granularity);
  for (long index = 0; index < g_engine.input_count; ++index) {
    g_engine.buffers[index].isInput = ASIOTrue;
    g_engine.buffers[index].channelNum = options.input_channel + index;
  }
  for (long index = 0; index < g_engine.output_count; ++index) {
    const long buffer_index = g_engine.input_count + index;
    g_engine.buffers[buffer_index].isInput = ASIOFalse;
    g_engine.buffers[buffer_index].channelNum = index;
  }
  g_engine.callbacks = {buffer_switch, sample_rate_changed, asio_message, buffer_switch_time_info};
  const long count = g_engine.input_count + g_engine.output_count;
  if (ASIOCreateBuffers(g_engine.buffers, count, g_engine.buffer_size, &g_engine.callbacks) != ASE_OK) return false;
  g_engine.buffers_created = true;
  for (long index = 0; index < count; ++index) {
    g_engine.channels[index].channel = g_engine.buffers[index].channelNum;
    g_engine.channels[index].isInput = g_engine.buffers[index].isInput;
    if (ASIOGetChannelInfo(&g_engine.channels[index]) != ASE_OK || bytes_per_sample(g_engine.channels[index].type) == 0) return false;
  }
  ASIOGetLatencies(&g_engine.input_latency, &g_engine.output_latency);
  g_engine.output_ready = ASIOOutputReady() == ASE_OK;
  return true;
}

void cleanup() {
  if (g_engine.buffers_created) ASIODisposeBuffers();
  ASIOExit();
  if (g_drivers != nullptr) g_drivers->removeCurrentDriver();
}

int list_drivers() {
  AsioDrivers drivers;
  std::vector<std::array<char, 64>> names(32);
  std::vector<char*> pointers;
  for (auto& name : names) pointers.push_back(name.data());
  const long count = drivers.getDriverNames(pointers.data(), static_cast<long>(pointers.size()));
  std::cout << "{\"event\":\"drivers\",\"drivers\":[";
  for (long index = 0; index < count; ++index) {
    if (index > 0) std::cout << ',';
    std::cout << "\"" << escape_json(names[index].data()) << "\"";
  }
  std::cout << "]}" << std::endl;
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  const auto options = parse_options(argc, argv);
  if (!options.has_value()) {
    emit("{\"event\":\"error\",\"message\":\"Usage: --list | --driver NAME [--buffer-size N]\"}");
    return 2;
  }
  if (options->list) return list_drivers();
  if (options->driver_name.empty()) {
    emit("{\"event\":\"error\",\"message\":\"ASIO driver name is required\"}");
    return 2;
  }

  SetConsoleCtrlHandler(console_handler, TRUE);
  std::signal(SIGINT, stop_handler);
  g_drivers = new AsioDrivers();
  if (!loadAsioDriver(const_cast<char*>(options->driver_name.c_str()))) {
    emit("{\"event\":\"error\",\"message\":\"Could not open ASIO driver\"}");
    return 1;
  }
  g_engine.info.asioVersion = 2;
  g_engine.info.sysRef = GetConsoleWindow();
  if (ASIOInit(&g_engine.info) != ASE_OK) {
    emit("{\"event\":\"error\",\"message\":\"ASIOInit failed: " + escape_json(g_engine.info.errorMessage) + "\"}");
    cleanup();
    return 1;
  }
  if (options->sample_rate > 0.0 && ASIOCanSampleRate(options->sample_rate) == ASE_OK) ASIOSetSampleRate(options->sample_rate);
  if (!create_buffers(*options) || ASIOStart() != ASE_OK) {
    emit("{\"event\":\"error\",\"message\":\"Could not start ASIO full-duplex stream\"}");
    cleanup();
    return 1;
  }
  ASIOSampleRate rate = 0.0;
  ASIOGetSampleRate(&rate);
  std::ostringstream started;
  started << "{\"event\":\"started\",\"driver\":\"" << escape_json(g_engine.info.name)
          << "\",\"sample_rate\":" << rate << ",\"buffer_size\":" << g_engine.buffer_size
          << ",\"input_latency\":" << g_engine.input_latency << ",\"output_latency\":" << g_engine.output_latency << "}";
  emit(started.str());
  while (g_running) {
    std::ostringstream level;
    level << "{\"event\":\"level\",\"rms_db\":" << g_rms.load()
          << ",\"clipping\":" << (g_clipping.load() ? "true" : "false") << "}";
    emit(level.str());
    Sleep(100);
  }
  ASIOStop();
  cleanup();
  emit("{\"event\":\"stopped\"}");
  return 0;
}
