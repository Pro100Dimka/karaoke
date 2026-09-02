#pragma once
#include <array>
#include <cstdint>

// Host-side implementation of the documented Logitech G213 five-zone direct
// lighting command. The keyboard exposes this vendor HID endpoint separately
// from its input endpoints, so lighting never writes keyboard reports.
namespace logitech_g213_lighting {
using Packet = std::array<uint8_t, 20>;

inline bool endpoint(unsigned vid, unsigned pid, unsigned page, unsigned usage,
                     int interface_number) {
    return vid == 0x046d && pid == 0xc336 && page == 0xff43 &&
           usage == 0x0602 && interface_number == 1;
}

inline Packet direct(unsigned zone, uint8_t r, uint8_t g, uint8_t b) {
    if (zone < 1 || zone > 5) return {};
    Packet packet{};
    packet[0] = 0x11;
    packet[1] = 0xff;
    packet[2] = 0x0c;
    packet[3] = 0x3a;
    packet[4] = static_cast<uint8_t>(zone);
    packet[5] = 0x01;
    packet[6] = r;
    packet[7] = g;
    packet[8] = b;
    packet[9] = 0x02;
    return packet;
}
}
