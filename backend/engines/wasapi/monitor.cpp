// Local shared-mode I/O only. DSP stays in the existing monitor worker.
#define NOMINMAX
#include <windows.h>
#include <audioclient.h>
#include <mmdeviceapi.h>
#include <functiondiscoverykeys_devpkey.h>
#include <ksmedia.h>
#include <avrt.h>
#include <wrl/client.h>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>
#include "monitor_buffer.h"

using Microsoft::WRL::ComPtr;
using Process = int (__cdecl *)(const float*, float*, uint32_t);
struct Info {
    uint32_t sample_rate, output_sample_rate, blocksize, input_period, output_period;
    uint32_t input_buffer, output_buffer;
    double input_latency_ms, output_latency_ms;
};
struct Statistics {
    uint64_t captured_frames = 0, rendered_frames = 0, dropped_frames = 0;
    uint64_t underruns = 0, discontinuities = 0, queued_frames = 0;
    double stream_latency_ms = -1;
};
static void check(HRESULT hr, const char* operation) {
    if (SUCCEEDED(hr)) return;
    std::ostringstream out;
    out << operation << ": HRESULT 0x" << std::hex << static_cast<uint32_t>(hr);
    throw std::runtime_error(out.str());
}
static void error_text(char* target, uint32_t size, const std::exception& error) {
    if (target && size) { strncpy_s(target, size, error.what(), _TRUNCATE); }
}
struct Apartment {
    bool initialized = false;
    Apartment() {
        const HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        // PortAudio may already have initialized this worker thread as STA.
        // We keep its apartment and do not uninitialize somebody else's COM.
        if (hr != RPC_E_CHANGED_MODE) { check(hr, "CoInitializeEx"); initialized = true; }
    }
    ~Apartment() { if (initialized) CoUninitialize(); }
};
struct Handle {
    HANDLE value = nullptr;
    ~Handle() { if (value) CloseHandle(value); }
};
static std::wstring name_of(IMMDevice* device) {
    ComPtr<IPropertyStore> store;
    check(device->OpenPropertyStore(STGM_READ, &store), "OpenPropertyStore");
    PROPVARIANT value{};
    const HRESULT hr = store->GetValue(PKEY_Device_FriendlyName, &value);
    std::wstring name = SUCCEEDED(hr) && value.vt == VT_LPWSTR ? value.pwszVal : L"";
    PropVariantClear(&value);
    check(hr, "Get endpoint name");
    return name;
}
static ComPtr<IMMDevice> find_device(IMMDeviceEnumerator* enumerator, EDataFlow flow, const wchar_t* name) {
    ComPtr<IMMDevice> result;
    if (!name || !*name) {
        check(enumerator->GetDefaultAudioEndpoint(flow, eConsole, &result), "Get default endpoint");
        return result;
    }
    ComPtr<IMMDeviceCollection> devices;
    check(enumerator->EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE, &devices), "EnumAudioEndpoints");
    UINT count = 0;
    check(devices->GetCount(&count), "Get endpoint count");
    for (UINT index = 0; index < count; ++index) {
        ComPtr<IMMDevice> item;
        check(devices->Item(index, &item), "Get endpoint");
        if (name_of(item.Get()) != name) continue;
        if (result) throw std::runtime_error("Selected audio endpoint name is ambiguous");
        result = item;
    }
    if (!result) throw std::runtime_error("Selected audio endpoint is unavailable; no default-device substitution");
    return result;
}
struct Endpoint {
    ComPtr<IAudioClient3> client;
    WAVEFORMATEX* format = nullptr;
    Handle event;
    UINT32 period = 0, buffer = 0;
    bool started = false, floating = false;
    ~Endpoint() {
        if (started) client->Stop();
        client.Reset();
        if (format) CoTaskMemFree(format);
    }
    void open(IMMDeviceEnumerator* enumerator, EDataFlow flow, const wchar_t* name, uint32_t requested, bool initialize) {
        auto device = find_device(enumerator, flow, name);
        check(device->Activate(__uuidof(IAudioClient3), CLSCTX_ALL, nullptr,
                              reinterpret_cast<void**>(client.GetAddressOf())), "Activate IAudioClient3");
        AudioClientProperties properties{};
        properties.cbSize = sizeof(properties);
        properties.eCategory = AudioCategory_Other;
        // Shared streams keep other applications audible; no exclusive mode.
        check(client->SetClientProperties(&properties), "SetClientProperties");
        check(client->GetMixFormat(&format), "GetMixFormat");
        WORD tag = format->wFormatTag;
        if (tag == WAVE_FORMAT_EXTENSIBLE && format->cbSize >= 22) {
            auto* ext = reinterpret_cast<WAVEFORMATEXTENSIBLE*>(format);
            if (ext->SubFormat == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT) tag = WAVE_FORMAT_IEEE_FLOAT;
            else if (ext->SubFormat == KSDATAFORMAT_SUBTYPE_PCM) tag = WAVE_FORMAT_PCM;
        }
        floating = tag == WAVE_FORMAT_IEEE_FLOAT && format->wBitsPerSample == 32;
        if (!floating && !(tag == WAVE_FORMAT_PCM && (format->wBitsPerSample == 16 || format->wBitsPerSample == 24 || format->wBitsPerSample == 32)))
            throw std::runtime_error("Unsupported WASAPI mix format");
        if (!format->nChannels || !format->nSamplesPerSec || format->nBlockAlign != format->nChannels * (format->wBitsPerSample / 8))
            throw std::runtime_error("Invalid WASAPI mix format");
        UINT32 normal = 0, fundamental = 0, minimum = 0, maximum = 0;
        check(client->GetSharedModeEnginePeriod(format, &normal, &fundamental, &minimum, &maximum), "GetSharedModeEnginePeriod");
        period = shared_audio::engine_period(requested, minimum, maximum, fundamental);
        if (!initialize) return;
        check(client->InitializeSharedAudioStream(AUDCLNT_STREAMFLAGS_EVENTCALLBACK, period, format, nullptr), "InitializeSharedAudioStream");
        event.value = CreateEventW(nullptr, FALSE, FALSE, nullptr);
        if (!event.value) throw std::runtime_error("CreateEvent failed");
        check(client->SetEventHandle(event.value), "SetEventHandle");
        check(client->GetBufferSize(&buffer), "GetBufferSize");
    }
    double latency() {
        REFERENCE_TIME value = 0;
        return SUCCEEDED(client->GetStreamLatency(&value)) ? value / 10000.0 : -1;
    }
    void start() { check(client->Start(), "Start shared stream"); started = true; }
    float read(const BYTE* data) const {
        return shared_audio::decode(data, format->wBitsPerSample, floating);
    }
    void write(BYTE* data, float sample) const {
        const unsigned bytes = format->wBitsPerSample / 8;
        for (unsigned channel = 0; channel < format->nChannels; ++channel)
            shared_audio::encode(data + channel * bytes, format->wBitsPerSample, floating, channel < 2 ? sample : 0);
    }
};
struct Engine {
    Apartment apartment; // Last member destroyed, after all COM interfaces.
    Endpoint input, output;
    ComPtr<IAudioCaptureClient> capture;
    ComPtr<IAudioRenderClient> render;
    ComPtr<IAudioClock> clock;
    UINT64 clock_frequency = 0, written_frames = 0;
    std::unique_ptr<shared_audio::MonitorBuffer> queue;
    std::vector<float> source, processed;
    Statistics stats;
    Process process = nullptr;
    HANDLE scheduling = nullptr;
    ~Engine() { if (scheduling) AvRevertMmThreadCharacteristics(scheduling); }
    void open(const wchar_t* input_name, const wchar_t* output_name, uint32_t blocksize, Info& info, bool initialize) {
        if (!blocksize || blocksize > 8192) throw std::runtime_error("Invalid fixed processing buffer");
        ComPtr<IMMDeviceEnumerator> enumerator;
        check(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator)), "Create enumerator");
        input.open(enumerator.Get(), eCapture, input_name, blocksize, initialize);
        output.open(enumerator.Get(), eRender, output_name, blocksize, initialize);
        info = {input.format->nSamplesPerSec, output.format->nSamplesPerSec, blocksize, input.period, output.period,
                input.buffer, output.buffer, initialize ? input.latency() : -1, initialize ? output.latency() : -1};
        if (!initialize) return;
        check(input.client->GetService(IID_PPV_ARGS(&capture)), "Get capture service");
        check(output.client->GetService(IID_PPV_ARGS(&render)), "Get render service");
        if (FAILED(output.client->GetService(IID_PPV_ARGS(&clock))) ||
            FAILED(clock->GetFrequency(&clock_frequency)) || !clock_frequency) clock.Reset();
        const double ratio = double(info.sample_rate) / info.output_sample_rate;
        const size_t capacity = 2 * std::max(input.period, UINT32(std::ceil(output.period * ratio))) + blocksize * 2;
        queue = std::make_unique<shared_audio::MonitorBuffer>(capacity, ratio);
        source.resize(blocksize);
        processed.resize(blocksize);
    }
    void start(Process callback) {
        process = callback;
        DWORD task = 0;
        scheduling = AvSetMmThreadCharacteristicsW(L"Pro Audio", &task);
        BYTE* data = nullptr;
        const UINT32 prime = std::min(output.period, output.buffer);
        check(render->GetBuffer(prime, &data), "Prime GetBuffer");
        check(render->ReleaseBuffer(prime, AUDCLNT_BUFFERFLAGS_SILENT), "Prime ReleaseBuffer");
        written_frames = prime;
        input.start();
        output.start();
    }
    void pump(uint32_t timeout) {
        HANDLE events[] = {input.event.value, output.event.value};
        if (WaitForMultipleObjects(2, events, FALSE, timeout) == WAIT_FAILED)
            throw std::runtime_error("Audio event wait failed");
        UINT32 available = 0;
        check(capture->GetNextPacketSize(&available), "GetNextPacketSize");
        // Capture first after either event. Do not wait for a second thread or
        // batch several engine periods before handing samples to playback.
        for (unsigned packet = 0; available && packet < 32; ++packet) {
            BYTE* data = nullptr;
            UINT32 frames = 0;
            DWORD flags = 0;
            UINT64 captured_qpc = 0;
            check(capture->GetBuffer(&data, &frames, &flags, nullptr, &captured_qpc), "Capture GetBuffer");
            if (flags & AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY) ++stats.discontinuities;
            bool ok = true;
            for (uint32_t offset = 0; offset < frames; ) {
                const uint32_t count = std::min<uint32_t>(frames - offset, uint32_t(source.size()));
                for (uint32_t index = 0; index < count; ++index)
                    source[index] = flags & AUDCLNT_BUFFERFLAGS_SILENT ? 0 : input.read(data + (offset + index) * input.format->nBlockAlign);
                if (!process(source.data(), processed.data(), count)) { ok = false; break; }
                const double timestamp = flags & AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR ? 0 : captured_qpc * 1e-7;
                queue->push(processed.data(), count, timestamp > 0 ? timestamp + double(offset) / input.format->nSamplesPerSec : 0,
                            1.0 / input.format->nSamplesPerSec);
                offset += count;
            }
            check(capture->ReleaseBuffer(frames), "Capture ReleaseBuffer");
            if (!ok) throw std::runtime_error("Microphone processing callback failed");
            stats.captured_frames += frames;
            check(capture->GetNextPacketSize(&available), "GetNextPacketSize");
        }
        UINT32 padding = 0;
        check(output.client->GetCurrentPadding(&padding), "GetCurrentPadding");
        // Allocation capacity is NOT a target queue depth. Submit at most one
        // engine period instead of filling the entire Windows render buffer.
        const UINT32 target = std::min(output.period, output.buffer);
        // An early render event must not enqueue a period of silence ahead of
        // microphone data that arrives a moment later. Submit only ready audio.
        const auto ready = UINT32(queue->available());
        const UINT32 count = padding < target ? std::min(target - padding, ready) : 0;
        if (count) {
            double presentation = 0;
            UINT64 position = 0, qpc = 0;
            if (clock && SUCCEEDED(clock->GetPosition(&position, &qpc)) && qpc) {
                const double played = double(position) / clock_frequency;
                // After an underrun the clock keeps advancing through silence.
                if (!padding) written_frames = std::max(written_frames, UINT64(played * output.format->nSamplesPerSec));
                presentation = qpc * 1e-7 + double(written_frames) / output.format->nSamplesPerSec - played;
            }
            BYTE* data = nullptr;
            check(render->GetBuffer(count, &data), "Render GetBuffer");
            bool starved = false;
            double transit = 0;
            unsigned timestamped = 0;
            for (UINT32 index = 0; index < count; ++index) {
                float sample = 0;
                double captured_at = 0;
                if (!queue->pop(sample, &captured_at)) starved = true;
                output.write(data + index * output.format->nBlockAlign, sample);
                const double age = presentation + double(index) / output.format->nSamplesPerSec - captured_at;
                if (captured_at > 0 && presentation > 0 && age >= 0 && age < 1) { transit += age; ++timestamped; }
            }
            check(render->ReleaseBuffer(count, 0), "Render ReleaseBuffer");
            if (starved) ++stats.underruns;
            stats.rendered_frames += count;
            written_frames += count;
            stats.stream_latency_ms = timestamped ? transit * 1000 / timestamped : -1;
        }
        stats.dropped_frames = queue->dropped();
        stats.queued_frames = queue->size();
    }
};

#define API extern "C" __declspec(dllexport)
API void* __cdecl wm_open(const wchar_t* input, const wchar_t* output, uint32_t blocksize, Info* info, char* error, uint32_t size) {
    try {
        auto engine = std::make_unique<Engine>();
        engine->open(input, output, blocksize, *info, true);
        return engine.release();
    } catch (const std::exception& failure) { error_text(error, size, failure); return nullptr; }
}
API int __cdecl wm_probe(const wchar_t* input, const wchar_t* output, uint32_t blocksize, Info* info, char* error, uint32_t size) {
    try { Engine engine; engine.open(input, output, blocksize, *info, false); return 1; }
    catch (const std::exception& failure) { error_text(error, size, failure); return 0; }
}
API int __cdecl wm_start(void* handle, Process callback, char* error, uint32_t size) {
    try { static_cast<Engine*>(handle)->start(callback); return 1; }
    catch (const std::exception& failure) { error_text(error, size, failure); return 0; }
}
API int __cdecl wm_pump(void* handle, uint32_t timeout, Statistics* stats, char* error, uint32_t size) {
    try { auto* engine = static_cast<Engine*>(handle); engine->pump(timeout); *stats = engine->stats; return 1; }
    catch (const std::exception& failure) { error_text(error, size, failure); return 0; }
}
API void __cdecl wm_close(void* handle) { delete static_cast<Engine*>(handle); }
