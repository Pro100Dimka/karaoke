#include "usb_lighting.h"
#include "vial_protocol.h"
#include "winbond_protocol.h"
#include <hidapi.h>
#include <wooting-rgb-sdk.h>
#include <memory>
#include <vector>

namespace {
struct WinbondDevice {
    hid_device* handle;
    winbond_lighting::Keyboard keyboard;
    explicit WinbondDevice(hid_device* h) : handle(h), keyboard(
        [this](const auto& p) { return hid_write(handle, p.data(), p.size()) == int(p.size()); },
        [this](uint8_t command, auto& response) {
            winbond_lighting::Packet p{1, command};
            if (hid_write(handle, p.data(), p.size()) != int(p.size())) return false;
            for (unsigned attempt=0; attempt<5; ++attempt) {
                const int n=hid_read_timeout(handle, response.data(), response.size(), 150);
                if (n<0) return false;
                if (n==64 && response[0]==1 && response[1]==command) return true;
            }
            return false;
        }) {}
    ~WinbondDevice() { keyboard.release(); hid_close(handle); }
};
struct VialDevice {
    hid_device* handle;
    vial_lighting::Keyboard keyboard;
    explicit VialDevice(hid_device* h) : handle(h), keyboard([this](const auto& p, auto& response) {
        unsigned char report[33]{};
        std::copy(p.begin(), p.end(), report + 1);
        if (hid_write(handle, report, sizeof(report)) != sizeof(report)) return false;
        // Dedicated vendor interface, never the keyboard input interface.
        for (unsigned tries = 0; tries < 3; ++tries) {
            int size = hid_read_timeout(handle, response.data(), response.size(), 100);
            if (size <= 0) return false;
            if (size == 32 && vial_lighting::reply(p, response)) return true;
        }
        return false;
    }) {}
    ~VialDevice() { keyboard.release(); hid_close(handle); }
};
std::vector<std::unique_ptr<VialDevice>> vials;
std::vector<std::unique_ptr<WinbondDevice>> winbonds;
std::vector<uint8_t> wooting;
bool wooting_owned = false;
bool wooting_failed = false;
void release() {
    winbonds.clear();
    vials.clear();
    if (wooting_owned) {
        for (auto i : wooting) {
            if (i >= wooting_usb_device_count()) break;
            if (wooting_usb_select_device(i)) wooting_rgb_reset_rgb();
        }
    }
    // Unlike rgb_close(), this does not reset devices we never animated.
    wooting_usb_disconnect(false);
    wooting.clear(); wooting_owned = false; wooting_failed = false;
}
}

// Called only by the serialized native worker, never by the renderer/audio thread.
UsbLightingStatus usb_lighting_request(int action, int r, int g, int b) {
    if (action == 2) { release(); return {}; }
    bool unsupported = false;
    if (action == 0) {
        release();
        wooting_rgb_kbd_connected();
        for (uint8_t i = 0; i < wooting_usb_device_count(); ++i) {
            const auto* meta = wooting_usb_get_device_meta(i);
            if (meta && meta->connected && meta->device_type != DEVICE_KEYPAD_3KEY && meta->max_rows && meta->max_columns)
                wooting.push_back(i);
        }
        auto* list = hid_enumerate(0, 0);
        unsigned inspected = 0;
        for (auto* item = list; item && inspected < 8; item = item->next) {
            if (winbond_lighting::endpoint(item->vendor_id, item->product_id, item->usage_page, item->usage, item->interface_number)) {
                ++inspected;
                if (auto* handle = hid_open_path(item->path)) {
                    auto device = std::make_unique<WinbondDevice>(handle);
                    if (device->keyboard.discover()) winbonds.push_back(std::move(device));
                    else unsupported = true;
                }
                continue;
            }
            if (item->usage_page != 0xff60 || item->usage != 0x61) continue;
            ++inspected;
            if (auto* handle = hid_open_path(item->path)) {
                auto device = std::make_unique<VialDevice>(handle);
                if (device->keyboard.discover()) vials.push_back(std::move(device));
                else unsupported = true;
            }
        }
        hid_free_enumeration(list);
    } else if (action == 1) {
        for (auto it = winbonds.begin(); it != winbonds.end();) {
            if ((*it)->keyboard.frame(uint8_t(r), uint8_t(g), uint8_t(b))) ++it;
            else it = winbonds.erase(it);
        }
        for (auto it = vials.begin(); it != vials.end();) {
            if ((*it)->keyboard.frame(uint8_t(r), uint8_t(g), uint8_t(b))) ++it;
            else it = vials.erase(it);
        }
        uint8_t colors[WOOTING_RGB_ROWS * WOOTING_RGB_COLS * 3];
        for (size_t i = 0; i < sizeof(colors); i += 3) { colors[i] = uint8_t(r); colors[i+1] = uint8_t(g); colors[i+2] = uint8_t(b); }
        for (auto i : wooting) {
            if (wooting_failed) break;
            if (i >= wooting_usb_device_count() || !wooting_usb_select_device(i)) { wooting_failed = true; break; }
            wooting_owned = true;
            wooting_rgb_array_auto_update(false);
            if (!wooting_rgb_array_set_full(colors) || !wooting_rgb_array_update_keyboard()) { wooting_failed = true; break; }
        }
    }
    const auto count = uint32_t(winbonds.size() + vials.size() + (wooting_failed ? 0 : wooting.size()));
    return {count, count ? "ready" : unsupported ? "unsupported" : "no_devices"};
}
