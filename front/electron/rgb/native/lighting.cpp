// Node-API bridge, loaded in Electron's main process so Windows can associate
// foreground lighting ownership with the actual application window.
#define NOMINMAX
#include <windows.h>
#include <node_api.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Devices.Enumeration.h>
#include <winrt/Windows.Devices.Lights.h>
#include <winrt/Windows.UI.h>
#include <chrono>
#include <array>
#include <mutex>
#include <vector>
#include <string>
#include "usb_lighting.h"
#include "lamp_zones.h"

// Resolve stable Node-API exports from the host; no Node/Electron ABI-specific
// import library or delay-load hook is needed.
#define API_LIST(X) \
 X(napi_get_cb_info) X(napi_get_value_int32) X(napi_create_promise) \
 X(napi_create_async_work) X(napi_queue_async_work) X(napi_delete_async_work) \
 X(napi_resolve_deferred) X(napi_create_string_utf8) X(napi_create_uint32) \
 X(napi_create_object) X(napi_set_named_property) X(napi_create_function)
struct Api {
#define FIELD(name) decltype(&name) name;
    API_LIST(FIELD)
#undef FIELD
} api;
using namespace winrt;
using namespace Windows::Devices::Lights;
using namespace Windows::Devices::Enumeration;
struct Device {
    LampArray lamps;
    std::vector<int32_t> indices;
    std::vector<unsigned> zones;
    std::chrono::steady_clock::time_point last{};
};
std::mutex devices_mutex;
std::vector<Device> devices;
struct Job {
    napi_async_work work{}; napi_deferred deferred{};
    int action = 0, r = 0, g = 0, b = 0;
    std::array<int, 15> colors{};
    uint32_t count = 0; std::string state = "no_devices";
    bool valid = true;
};
template<class Async> auto bounded_get(Async operation) {
    if (operation.wait_for(std::chrono::seconds(2)) != Windows::Foundation::AsyncStatus::Completed) {
        operation.Cancel(); throw hresult_error(HRESULT_FROM_WIN32(ERROR_TIMEOUT));
    }
    return operation.GetResults();
}
void execute(napi_env, void* data) {
    auto& job = *static_cast<Job*>(data);
    if (!job.valid) { job.state = "unavailable"; return; }
    const HRESULT apartment = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    try {
        std::lock_guard<std::mutex> guard(devices_mutex);
        if (job.action >= 3) {
            const auto status = usb_lighting_request(job.action - 3, job.r, job.g, job.b);
            job.count = status.count; job.state = status.state;
        } else {
        if (job.action == 0) {
            devices.clear();
            for (auto const& info : bounded_get(DeviceInformation::FindAllAsync(LampArray::GetDeviceSelector()))) {
                auto lamps = bounded_get(LampArray::FromIdAsync(info.Id()));
                if (lamps && lamps.LampArrayKind() == LampArrayKind::Keyboard) {
                    std::vector<int32_t> indices;
                    std::vector<float> positions;
                    for (int32_t index = 0; index < lamps.LampCount(); ++index) {
                        indices.push_back(index);
                        positions.push_back(lamps.GetLampInfo(index).Position().x);
                    }
                    devices.push_back({lamps, indices, lamp_zones::assign(positions, lamps.BoundingBox().x)});
                }
            }
        } else if (job.action == 2) {
            // Destroying our LampArray handles releases our ownership; don't
            // overwrite another application's colors or persist device modes.
            devices.clear();
        }
        unsigned available = 0;
        for (auto& device : devices) {
            if (!device.lamps.IsAvailable()) continue;
            ++available;
            const auto now = std::chrono::steady_clock::now();
            if (job.action == 1 && now - device.last >= device.lamps.MinUpdateInterval()) {
                std::vector<Windows::UI::Color> colors;
                colors.reserve(device.indices.size());
                for (const auto zone : device.zones) {
                    const auto offset = std::min(4U, zone) * 3;
                    colors.push_back({255, uint8_t(job.colors[offset]), uint8_t(job.colors[offset + 1]), uint8_t(job.colors[offset + 2])});
                }
                device.lamps.SetColorsForIndices(colors, device.indices);
                device.last = now;
            }
        }
        job.count = static_cast<uint32_t>(devices.size());
        job.state = available ? "ready" : devices.empty() ? "no_devices" : "blocked";
        }
    } catch (...) { job.state = "unavailable"; }
    if (SUCCEEDED(apartment)) CoUninitialize();
}
napi_value text(napi_env env, const char* value) {
    napi_value result; api.napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &result); return result;
}
void complete(napi_env env, napi_status, void* data) {
    auto* job = static_cast<Job*>(data);
    napi_value result, count;
    api.napi_create_object(env, &result);
    api.napi_create_uint32(env, job->count, &count);
    api.napi_set_named_property(env, result, "count", count);
    api.napi_set_named_property(env, result, "state", text(env, job->state.c_str()));
    api.napi_resolve_deferred(env, job->deferred, result);
    api.napi_delete_async_work(env, job->work); delete job;
}
napi_value request(napi_env env, napi_callback_info info) {
    size_t argc = 16; napi_value args[16]{};
    void* base = nullptr;
    api.napi_get_cb_info(env, info, &argc, args, nullptr, &base);
    auto* job = new Job;
    if (argc && api.napi_get_value_int32(env, args[0], &job->action) != napi_ok) job->valid = false;
    for (size_t i = 1; i < argc && i <= 15; ++i)
        if (api.napi_get_value_int32(env, args[i], &job->colors[i - 1]) != napi_ok) job->valid = false;
    job->valid = job->valid && (argc == 1 || argc == 4 || argc == 16) &&
        job->action >= 0 && job->action <= 2 && (job->action != 1 || argc == 4 || argc == 16);
    const size_t channel_count = argc > 1 ? argc - 1 : 0;
    for (size_t i = 0; i < channel_count; ++i)
        if (job->colors[i] < 0 || job->colors[i] > 255) job->valid = false;
    if (argc == 4) for (size_t zone = 1; zone < 5; ++zone)
        std::copy_n(job->colors.begin(), 3, job->colors.begin() + zone * 3);
    job->r = job->colors[0]; job->g = job->colors[1]; job->b = job->colors[2];
    job->action += static_cast<int>(reinterpret_cast<intptr_t>(base));
    napi_value promise;
    api.napi_create_promise(env, &job->deferred, &promise);
    api.napi_create_async_work(env, nullptr, text(env, "keyboard-lighting"), execute, complete, job, &job->work);
    api.napi_queue_async_work(env, job->work);
    return promise;
}
extern "C" __declspec(dllexport) napi_value napi_register_module_v1(napi_env env, napi_value exports) {
    auto host = GetModuleHandleW(nullptr);
#define LOAD(name) api.name = reinterpret_cast<decltype(api.name)>(GetProcAddress(host, #name)); if (!api.name) return exports;
    API_LIST(LOAD)
#undef LOAD
    napi_value function;
    api.napi_create_function(env, "request", NAPI_AUTO_LENGTH, request, nullptr, &function);
    api.napi_set_named_property(env, exports, "request", function);
    api.napi_create_function(env, "usbRequest", NAPI_AUTO_LENGTH, request, reinterpret_cast<void*>(3), &function);
    api.napi_set_named_property(env, exports, "usbRequest", function);
    return exports;
}
