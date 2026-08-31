// Standalone diagnostic: discards capture data and renders only silence.
// No application settings, endpoint defaults, volume or registry are changed.
#define NOMINMAX
#include <windows.h>
#include <audioclient.h>
#include <mmdeviceapi.h>
#include <functiondiscoverykeys_devpkey.h>
#include <avrt.h>
#include <wrl/client.h>
#include <algorithm>
#include <cmath>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

using Microsoft::WRL::ComPtr;

static void check(HRESULT hr, const char* operation) {
    if (SUCCEEDED(hr)) return;
    std::ostringstream error;
    error << operation << ": HRESULT 0x" << std::hex << static_cast<unsigned long>(hr);
    throw std::runtime_error(error.str());
}

static std::string quoted(const std::string& value) {
    std::string result = "\"";
    for (unsigned char c : value) {
        if (c == '\\' || c == '"') result += '\\';
        if (c >= 32) result += c;
    }
    return result + '"';
}

static std::string utf8(const wchar_t* value) {
    int size = WideCharToMultiByte(CP_UTF8, 0, value, -1, nullptr, 0, nullptr, nullptr);
    if (!size) return "";
    std::string result(size, '\0');
    WideCharToMultiByte(CP_UTF8, 0, value, -1, result.data(), size, nullptr, nullptr);
    result.pop_back();
    return result;
}

static double nowMs() {
    static LARGE_INTEGER frequency = [] { LARGE_INTEGER x; QueryPerformanceFrequency(&x); return x; }();
    LARGE_INTEGER value;
    QueryPerformanceCounter(&value);
    return static_cast<double>(value.QuadPart) * 1000.0 / frequency.QuadPart;
}

struct Endpoint {
    ComPtr<IMMDevice> device;
    ComPtr<IAudioClient3> client;
    WAVEFORMATEX* format = nullptr;
    HANDLE event = nullptr;
    bool started = false;
    UINT32 defaultPeriod = 0, fundamental = 0, minimum = 0, maximum = 0, buffer = 0;
    std::string name;

    ~Endpoint() {
        if (started) client->Stop();
        client.Reset();
        if (event) CloseHandle(event);
        if (format) CoTaskMemFree(format);
    }

    void discover(IMMDeviceEnumerator* enumerator, EDataFlow flow, bool raw) {
        check(enumerator->GetDefaultAudioEndpoint(flow, eConsole, &device), "GetDefaultAudioEndpoint");
        ComPtr<IPropertyStore> properties;
        check(device->OpenPropertyStore(STGM_READ, &properties), "OpenPropertyStore");
        PROPVARIANT value;
        PropVariantInit(&value);
        HRESULT hr = properties->GetValue(PKEY_Device_FriendlyName, &value);
        if (SUCCEEDED(hr) && value.vt == VT_LPWSTR) name = utf8(value.pwszVal);
        PropVariantClear(&value);
        check(device->Activate(__uuidof(IAudioClient3), CLSCTX_ALL, nullptr,
                              reinterpret_cast<void**>(client.GetAddressOf())), "Activate IAudioClient3");
        AudioClientProperties config = {};
        config.cbSize = sizeof(config);
        config.eCategory = AudioCategory_Other;
        config.Options = raw ? AUDCLNT_STREAMOPTIONS_RAW : AUDCLNT_STREAMOPTIONS_NONE;
        check(client->SetClientProperties(&config), "SetClientProperties");
        check(client->GetMixFormat(&format), "GetMixFormat");
        check(client->GetSharedModeEnginePeriod(format, &defaultPeriod, &fundamental, &minimum, &maximum),
              "GetSharedModeEnginePeriod");
    }

    bool supports(UINT32 frames) const {
        return fundamental && frames >= minimum && frames <= maximum && frames % fundamental == 0;
    }

    void print(const char* kind, UINT32 requested) {
        WAVEFORMATEX* currentFormat = nullptr;
        UINT32 current = 0;
        HRESULT currentResult = client->GetCurrentSharedModeEnginePeriod(&currentFormat, &current);
        if (currentFormat) CoTaskMemFree(currentFormat);
        std::cout << "{\"event\":\"endpoint\",\"kind\":" << quoted(kind)
                  << ",\"name\":" << quoted(name) << ",\"sample_rate\":" << format->nSamplesPerSec
                  << ",\"channels\":" << format->nChannels << ",\"default_frames\":" << defaultPeriod
                  << ",\"fundamental_frames\":" << fundamental << ",\"min_frames\":" << minimum
                  << ",\"max_frames\":" << maximum << ",\"requested_frames\":" << requested
                  << ",\"requested_supported\":" << (supports(requested) ? "true" : "false")
                  << ",\"current_frames\":" << (SUCCEEDED(currentResult) ? std::to_string(current) : "null")
                  << "}" << std::endl;
    }

    void initialize(UINT32 frames) {
        if (!supports(frames)) throw std::runtime_error("Requested period unsupported; no automatic substitution");
        check(client->InitializeSharedAudioStream(AUDCLNT_STREAMFLAGS_EVENTCALLBACK, frames, format, nullptr),
              "InitializeSharedAudioStream");
        event = CreateEventW(nullptr, FALSE, FALSE, nullptr);
        if (!event) throw std::runtime_error("CreateEvent failed");
        check(client->SetEventHandle(event), "SetEventHandle");
        check(client->GetBufferSize(&buffer), "GetBufferSize");
    }
    void start() { check(client->Start(), "Start"); started = true; }
};

static void summary(const char* name, std::vector<double>& values) {
    std::cout << ",\"" << name << "\":";
    if (values.empty()) { std::cout << "null"; return; }
    std::sort(values.begin(), values.end());
    std::cout << "{\"min\":" << values.front() << ",\"median\":" << values[values.size()/2]
              << ",\"p95\":" << values[std::min(values.size()-1, values.size()*95/100)]
              << ",\"max\":" << values.back() << "}";
}

struct AudioScheduling {
    HANDLE task = nullptr;
    AudioScheduling() { DWORD index = 0; task = AvSetMmThreadCharacteristicsW(L"Pro Audio", &index); }
    ~AudioScheduling() { if (task) AvRevertMmThreadCharacteristics(task); }
};

static int probe(bool run, bool raw, UINT32 requested, double seconds) {
    ComPtr<IMMDeviceEnumerator> enumerator;
    check(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                           IID_PPV_ARGS(&enumerator)), "Create enumerator");
    Endpoint input, output;
    input.discover(enumerator.Get(), eCapture, raw);
    output.discover(enumerator.Get(), eRender, raw);
    input.print("capture", requested);
    output.print("render", requested);
    if (!run) return 0;
    input.initialize(requested);
    output.initialize(requested);
    ComPtr<IAudioCaptureClient> capture;
    ComPtr<IAudioRenderClient> render;
    check(input.client->GetService(IID_PPV_ARGS(&capture)), "Get capture service");
    check(output.client->GetService(IID_PPV_ARGS(&render)), "Get render service");
    BYTE* data = nullptr;
    check(render->GetBuffer(output.buffer, &data), "Prime render buffer");
    check(render->ReleaseBuffer(output.buffer, AUDCLNT_BUFFERFLAGS_SILENT), "Prime silence");
    AudioScheduling scheduling;
    std::vector<double> captureAge, captureIntervals, renderIntervals;
    for (auto* values : { &captureAge, &captureIntervals, &renderIntervals }) values->reserve(50000);
    UINT64 capturedFrames = 0, renderedFrames = 0, packets = 0, renderCalls = 0;
    UINT64 discontinuities = 0, startupDiscontinuities = 0, timestampErrors = 0, renderEmpty = 0, timeouts = 0;
    double previousCapture = 0, previousRender = 0;
    double started = nowMs();
    input.start();
    output.start();
    HANDLE events[] = { input.event, output.event };
    while (nowMs() - started < seconds * 1000) {
        DWORD wait = WaitForMultipleObjects(2, events, FALSE, 100);
        if (wait == WAIT_FAILED) throw std::runtime_error("WaitForMultipleObjects failed");
        if (wait == WAIT_TIMEOUT) ++timeouts;
        // Drain both endpoints after each wake: ordering must not starve render.
        UINT32 available = 0;
        check(capture->GetNextPacketSize(&available), "GetNextPacketSize");
        while (available) {
            UINT32 frames = 0;
            DWORD flags = 0;
            UINT64 position = 0, qpc = 0;
            check(capture->GetBuffer(&data, &frames, &flags, &position, &qpc), "Capture GetBuffer");
            const double now = nowMs();
            const bool steady = now - started > 300;
            ++packets;
            capturedFrames += frames;
            if (flags & AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY) {
                if (steady) ++discontinuities; else ++startupDiscontinuities;
            }
            if (flags & AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR) ++timestampErrors;
            if (steady && captureAge.size() < 50000 && !(flags & AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR))
                captureAge.push_back(now - static_cast<double>(qpc) / 10000.0);
            if (steady && previousCapture && captureIntervals.size() < 50000)
                captureIntervals.push_back(now - previousCapture);
            previousCapture = now;
            // Never read, copy, persist or transmit captured microphone samples.
            check(capture->ReleaseBuffer(frames), "Capture ReleaseBuffer");
            check(capture->GetNextPacketSize(&available), "GetNextPacketSize");
        }
        UINT32 padding = 0;
        check(output.client->GetCurrentPadding(&padding), "GetCurrentPadding");
        if (padding > output.buffer) throw std::runtime_error("Invalid render padding");
        available = output.buffer - padding;
        if (available) {
            const double now = nowMs();
            if (now - started > 300) {
                if (!padding) ++renderEmpty;
                if (previousRender && renderIntervals.size() < 50000) renderIntervals.push_back(now - previousRender);
            }
            previousRender = now;
            check(render->GetBuffer(available, &data), "Render GetBuffer");
            check(render->ReleaseBuffer(available, AUDCLNT_BUFFERFLAGS_SILENT), "Render silence");
            renderedFrames += available;
            ++renderCalls;
        }
    }
    std::cout << "{\"event\":\"result\",\"silent\":true,\"raw\":" << (raw ? "true" : "false")
              << ",\"requested_frames\":" << requested << ",\"duration_ms\":" << nowMs()-started
              << ",\"mmcss\":" << (scheduling.task ? "true" : "false")
              << ",\"input_buffer_frames\":" << input.buffer << ",\"output_buffer_frames\":" << output.buffer
              << ",\"capture_packets\":" << packets << ",\"render_calls\":" << renderCalls
              << ",\"captured_frames\":" << capturedFrames << ",\"rendered_frames\":" << renderedFrames
              << ",\"capture_discontinuities\":" << discontinuities
              << ",\"startup_discontinuities\":" << startupDiscontinuities
              << ",\"timestamp_errors\":" << timestampErrors << ",\"render_empty_observations\":" << renderEmpty
              << ",\"event_timeouts\":" << timeouts;
    summary("capture_packet_age_ms", captureAge);
    summary("capture_callback_interval_ms", captureIntervals);
    summary("render_callback_interval_ms", renderIntervals);
    std::cout << ",\"round_trip_latency_ms\":null}" << std::endl;
    input.print("capture_after_run", requested);
    output.print("render_after_run", requested);
    return 0;
}

int main(int argc, char** argv) {
    bool initialized = false;
    try {
        bool run = false, raw = false;
        UINT32 frames = 128;
        double seconds = 3;
        for (int i = 1; i < argc; ++i) {
            const std::string arg = argv[i];
            if (arg == "--run") run = true;
            else if (arg == "--raw") raw = true;
            else if (arg == "--frames" && i + 1 < argc) frames = std::stoul(argv[++i]);
            else if (arg == "--seconds" && i + 1 < argc) seconds = std::stod(argv[++i]);
            else throw std::runtime_error("Usage: probe_iaudioclient3 [--run] [--raw] [--frames N] [--seconds 0.3..30]");
        }
        if (!frames || frames > 192000 || !std::isfinite(seconds) || seconds < .3 || seconds > 30)
            throw std::runtime_error("Invalid probe bounds");
        check(CoInitializeEx(nullptr, COINIT_MULTITHREADED), "CoInitializeEx");
        initialized = true;
        std::cout << std::fixed << std::setprecision(3);
        const int result = probe(run, raw, frames, seconds);
        CoUninitialize();
        return result;
    } catch (const std::exception& error) {
        if (initialized) CoUninitialize();
        std::cout << "{\"event\":\"error\",\"message\":" << quoted(error.what()) << "}" << std::endl;
        return 1;
    }
}
