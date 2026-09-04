#pragma once
#include <algorithm>
#include <array>
#include <cstdint>
#include <functional>
#include <string>
#include <utility>

// Host-side protocol independently reconstructed from HATOR keyboard software
// V1.04.15 (SHA256 54794f9d86c34b15d04aff10632d7d36a5e1c979e483033dc7d7b67cfe4dafa9).
// Official download: https://www.hator.gg/hator_rockfall_2_software/
// Sync toggle: 0x6709a0; streamed RGB: 0x65f460/0x65ff10 in that PE image.
// 0x17 enters/exits host synchronization; 0x0f streams 132 RGB cells.
// Do NOT substitute saved-mode 0x07 or saved-custom-color 0x09 commands.
namespace winbond_lighting {
using Packet = std::array<uint8_t, 64>;
using Write = std::function<bool(const Packet&)>;
using Read = std::function<bool(uint8_t, Packet&)>;
inline bool endpoint(unsigned vid, unsigned pid, unsigned page, unsigned usage, int interface_number) {
    return vid == 0x0416 && pid == 0xb23c && page == 0xff1b && usage == 0x91 && interface_number == 2;
}
inline Packet sync(bool enabled) { Packet p{1, 0x17, 0, 0, 0, 1, uint8_t(enabled)}; return p; }
inline Packet colors(unsigned index, uint8_t r, uint8_t g, uint8_t b) {
    Packet p{};
    if (index >= 8) return p;
    p = {1, 0x0f, 0, 0, uint8_t(index), uint8_t(index == 7 ? 18 : 54)};
    for (unsigned at = 6; at < unsigned(6 + p[5]); at += 3) {
        p[at] = r; p[at+1] = g; p[at+2] = b;
    }
    return p;
}
// K188 commits a host frame only after both auxiliary-zone packets arrive.
// The keyboard has no visible LEDs in that zone, but omitting these packets
// leaves the previous firmware animation frozen instead of applying key RGB.
inline Packet auxiliary(unsigned index) {
    if (index >= 2) return {};
    Packet p{1, 0x0f, 1, 0, uint8_t(index), uint8_t(index == 0 ? 54 : 45)};
    return p;
}
inline bool recognized(const Packet& version, const Packet& modes) {
    if (version[0] != 1 || version[1] != 0x0d || modes[0] != 1 || modes[1] != 0x0a) return false;
    std::string text(version.begin()+5, std::find(version.begin()+5, version.end(), uint8_t(0)));
    if (text.find("2NUC,01,KB,FL,") != 0 || text.find(",V") == std::string::npos) return false;
    // These controller families use the same streaming path in the official app.
    // USB VID/PID alone is insufficient: unrelated firmware can reuse them.
    constexpr const char* models[] = {"K188BRGB", "K202R2MRGB", "K202HRMTKLRGB", "K202HTK520RGB",
        "K202HTK521RGB", "K202MechaRGB", "K202MechaIRRGB", "K202ERGB", "K202EVORGB",
        "K669HATORRGB", "K669HSTKLRGB", "K669HSTPRGB"};
    bool model = false;
    for (auto name : models) if (text.find(std::string("2NUC,01,KB,FL,") + name + ",V") == 0) model = true;
    const unsigned length = modes[5];
    if (!model || length < 4 || length > 58) return false;
    // Mode list trailer identifies this protocol generation, not a key report.
    return modes[6+length-4] == 0xa5 && modes[6+length-3] == 0x5a;
}
class Keyboard {
    Write write;
    Read read;
    bool supported = false, owned = false;
public:
    Keyboard(Write w, Read r) : write(std::move(w)), read(std::move(r)) {}
    bool discover() {
        Packet version{}, modes{};
        supported = read(0x0d, version) && read(0x0a, modes) && recognized(version, modes);
        return supported;
    }
    bool frame(uint8_t r, uint8_t g, uint8_t b) {
        if (!supported) return false;
        if (!owned) {
            owned = true; // Release even if the transport loses the enter acknowledgement.
            if (!write(sync(true))) { release(); return false; }
        }
        for (unsigned i = 0; i < 8; ++i) {
            if (!write(colors(i, r, g, b))) { release(); return false; }
        }
        for (unsigned i = 0; i < 2; ++i) {
            if (!write(auxiliary(i))) { release(); return false; }
        }
        return true;
    }
    void release() {
        if (!owned) return;
        owned = false;
        write(sync(false));
    }
};
}
