// Standalone comparison only; not linked into the application.
// Build with /MT and pinned miniaudio 0.11.25 on the include path.
// Captured samples are discarded; output is always silence. No settings change.
#define NOMINMAX
#include <windows.h>
#include <audioclient.h>
#define MA_ENABLE_ONLY_SPECIFIC_BACKENDS
#define MA_ENABLE_WASAPI
#define MA_NO_ENGINE
#define MA_NO_RESOURCE_MANAGER
#define MA_NO_NODE_GRAPH
#define MA_NO_DECODING
#define MA_NO_ENCODING
#define MINIAUDIO_IMPLEMENTATION
#include "miniaudio.h"
#include <algorithm>
#include <array>
#include <iostream>
#include <iomanip>

struct Measurements {
    std::array<double, 16384> intervals{};
    size_t count = 0;
    ma_uint64 frames = 0;
    ma_uint32 minimum = UINT32_MAX, maximum = 0;
    LARGE_INTEGER previous{}, frequency{};
};

static void callback(ma_device* device, void* output, const void*, ma_uint32 frames) {
    if (output) ma_silence_pcm_frames(output, frames, device->playback.format, device->playback.channels);
    auto& stats = *static_cast<Measurements*>(device->pUserData);
    LARGE_INTEGER now;
    QueryPerformanceCounter(&now);
    if (stats.previous.QuadPart && stats.count < stats.intervals.size())
        stats.intervals[stats.count++] = 1000.0 * (now.QuadPart - stats.previous.QuadPart) / stats.frequency.QuadPart;
    stats.previous = now;
    stats.frames += frames;
    stats.minimum = std::min(stats.minimum, frames);
    stats.maximum = std::max(stats.maximum, frames);
}

static void describe_client(const char* name, ma_ptr pointer) {
    auto* client = static_cast<IAudioClient*>(pointer);
    IAudioClient3* client3 = nullptr;
    if (!client || FAILED(client->QueryInterface(__uuidof(IAudioClient3), reinterpret_cast<void**>(&client3)))) {
        std::cout << name << " IAudioClient3 unavailable\n";
        return;
    }
    WAVEFORMATEX* format = nullptr;
    UINT32 current = 0, normal = 0, fundamental = 0, minimum = 0, maximum = 0;
    if (SUCCEEDED(client3->GetCurrentSharedModeEnginePeriod(&format, &current))) {
        const HRESULT hr = client3->GetSharedModeEnginePeriod(format, &normal, &fundamental, &minimum, &maximum);
        std::cout << name << " sample_rate=" << format->nSamplesPerSec << " current_frames=" << current
                  << " current_ms=" << 1000.0 * current / format->nSamplesPerSec;
        if (SUCCEEDED(hr)) std::cout << " minimum_frames=" << minimum << " default_frames=" << normal;
        std::cout << '\n';
        CoTaskMemFree(format);
    } else std::cout << name << " shared period query unavailable\n";
    client3->Release();
}

static bool run(ma_context& context, bool fixed) {
    Measurements stats;
    QueryPerformanceFrequency(&stats.frequency);
    auto config = ma_device_config_init(ma_device_type_duplex);
    config.playback.shareMode = ma_share_mode_shared;
    config.capture.shareMode = ma_share_mode_shared;
    config.playback.format = ma_format_f32;
    config.capture.format = ma_format_f32;
    config.periodSizeInFrames = 64;
    config.periods = 1;
    config.performanceProfile = ma_performance_profile_low_latency;
    config.noFixedSizedCallback = !fixed;
    config.wasapi.noAutoStreamRouting = MA_TRUE;
    config.dataCallback = callback;
    config.pUserData = &stats;
    ma_device device;
    ma_result result = ma_device_init(&context, &config, &device);
    if (result != MA_SUCCESS) {
        std::cerr << "shared init failed: " << ma_result_description(result) << '\n';
        return false;
    }
    std::cout << "mode=shared fixed_callback=" << fixed << " requested_frames=64\n"
              << "input=" << device.capture.name << " output=" << device.playback.name << '\n';
    describe_client("input", device.wasapi.pAudioClientCapture);
    describe_client("output", device.wasapi.pAudioClientPlayback);
    result = ma_device_start(&device);
    if (result == MA_SUCCESS) {
        Sleep(3000);
        ma_device_stop(&device);
        std::sort(stats.intervals.begin(), stats.intervals.begin() + stats.count);
        std::cout << "frames=" << stats.frames << " callback_frames_min=" << stats.minimum
                  << " callback_frames_max=" << stats.maximum;
        if (stats.count) std::cout << " callback_interval_median_ms=" << stats.intervals[stats.count / 2]
                                  << " callback_interval_p95_ms=" << stats.intervals[(stats.count - 1) * 95 / 100];
        std::cout << "\nphysical_round_trip_ms=not_measured\n";
    } else std::cerr << "shared start failed: " << ma_result_description(result) << '\n';
    ma_device_uninit(&device);
    return result == MA_SUCCESS;
}

int main() {
    SetConsoleOutputCP(CP_UTF8);
    std::cout << std::fixed << std::setprecision(3);
    std::cout << "miniaudio=" << MA_VERSION_STRING << " shared-only; silence output; no saved audio\n"
              << "Callback cadence is not physical microphone-to-speaker latency.\n";
    ma_context context;
    const ma_backend backend = ma_backend_wasapi;
    if (ma_context_init(&backend, 1, nullptr, &context) != MA_SUCCESS) return 1;
    const bool variable = run(context, false);
    const bool fixed = run(context, true);
    ma_context_uninit(&context);
    return variable && fixed ? 0 : 1;
}
