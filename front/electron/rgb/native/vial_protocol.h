#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <functional>
#include <utility>

// Independently implemented host-side VialRGB v1 wire protocol:
// https://get.vial.today/docs/lighting.html
// https://github.com/vial-kb/vial-qmk/blob/vial/quantum/vialrgb.c
// 0x07/0x41 sets volatile mode/HSV (no EEPROM); never issue SAVE (0x09).
namespace vial_lighting {
using Packet = std::array<uint8_t, 32>;
using Exchange = std::function<bool(const Packet&, Packet&)>;
inline unsigned word(const Packet& p, unsigned at) { return p[at] | (p[at + 1] << 8); }
inline Packet query(uint8_t command) { Packet p{}; p[0] = 8; p[1] = command; return p; }
inline bool reply(const Packet& sent, const Packet& received) {
    return sent[0] == received[0] && sent[1] == received[1];
}
inline std::array<uint8_t, 3> hsv(uint8_t r, uint8_t g, uint8_t b) {
    double hi = std::max({r, g, b}), lo = std::min({r, g, b}), d = hi - lo;
    double hue = !d ? 0 : hi == r ? (g - double(b)) / d : hi == g ? 2 + (b - double(r)) / d : 4 + (r - double(g)) / d;
    if (hue < 0) hue += 6;
    return {uint8_t(std::lround(hue * 255 / 6)), uint8_t(hi ? std::lround(d * 255 / hi) : 0), uint8_t(hi)};
}
class Keyboard {
    Exchange exchange;
    Packet original{}, last{};
    bool supported = false, owned = false;
    uint8_t maximum = 0;
    bool get(uint8_t command, Packet& response) {
        auto p = query(command);
        return exchange(p, response) && reply(p, response);
    }
public:
    explicit Keyboard(Exchange transport) : exchange(std::move(transport)) {}
    bool discover() {
        Packet info{}, effects{};
        if (!get(0x40, info) || word(info, 2) != 1 || !info[4] || !get(0x42, effects)) return false;
        bool solid = false;
        for (unsigned i = 2; i < 32; i += 2) if (word(effects, i) == 2) solid = true;
        if (!solid || !get(0x41, original)) return false;
        // Another direct-control app owns colors which the protocol cannot read.
        if (word(original, 2) == 1 || word(original, 2) == 0xffff) return false;
        maximum = info[4];
        original[0] = 7;
        supported = true;
        return true;
    }
    bool frame(uint8_t r, uint8_t g, uint8_t b) {
        if (!supported) return false;
        Packet p{}, answer{};
        p[0] = 7; p[1] = 0x41; p[2] = 2; p[4] = original[4];
        const auto color = hsv(r, g, b);
        std::copy(color.begin(), color.end(), p.begin() + 5);
        p[7] = std::min(p[7], maximum);
        last = p; owned = true;
        return exchange(p, answer) && reply(p, answer);
    }
    void release() {
        if (!owned) return;
        owned = false;
        Packet current{}, answer{};
        // Don't overwrite changes made in the meantime by another application.
        if (get(0x41, current) && std::equal(last.begin() + 2, last.begin() + 8, current.begin() + 2))
            exchange(original, answer);
    }
};
}
