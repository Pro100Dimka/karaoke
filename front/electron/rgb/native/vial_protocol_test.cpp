#include "vial_protocol.h"
#include <iostream>
#include <stdexcept>
#include <vector>
using namespace vial_lighting;
void require(bool ok) { if (!ok) throw std::runtime_error("VialRGB protocol assertion failed"); }
struct Fake {
    Packet current = {8, 0x41, 6, 0, 12, 30, 40, 50};
    std::vector<Packet> writes;
    bool recognized = true, solid = true;
    bool exchange(const Packet& p, Packet& r) {
        r = p;
        if (p[0] == 8 && p[1] == 0x40) { r[2] = recognized ? 1 : 0; r[4] = 128; }
        else if (p[0] == 8 && p[1] == 0x42) { r.fill(255); r[0] = 8; r[1] = 0x42; r[2] = solid ? 2 : 3; r[3] = 0; }
        else if (p[0] == 8 && p[1] == 0x41) { r = current; r[0] = 8; }
        else if (p[0] == 7 && p[1] == 0x41) { writes.push_back(p); current = p; }
        else throw std::runtime_error("Unexpected or unsafe HID command");
        return true;
    }
    Keyboard keyboard() { return Keyboard([this](const auto& p, auto& r) { return exchange(p, r); }); }
};
int main() {
    require(hsv(255, 0, 0) == std::array<uint8_t, 3>{0, 255, 255});
    require(hsv(0, 255, 0) == std::array<uint8_t, 3>{85, 255, 255});
    require(hsv(0, 0, 255) == std::array<uint8_t, 3>{170, 255, 255});
    require(hsv(0, 0, 0) == std::array<uint8_t, 3>{0, 0, 0});
    Fake f; auto original = f.current; auto k = f.keyboard();
    require(!k.frame(1, 2, 3)); require(k.discover()); require(f.writes.empty());
    require(k.frame(255, 0, 0)); require(f.writes.back()[7] == 128);
    k.release(); require(f.writes.size() == 2);
    require(std::equal(original.begin()+2, original.begin()+8, f.current.begin()+2));
    k.release(); require(f.writes.size() == 2);
    require(k.frame(1, 2, 3)); f.current[2] = 3; k.release(); require(f.writes.size() == 3);
    for (int mode = 0; mode < 3; ++mode) {
        Fake invalid;
        if (mode == 0) invalid.recognized = false;
        if (mode == 1) invalid.solid = false;
        if (mode == 2) invalid.current[2] = 1;
        auto rejected = invalid.keyboard(); require(!rejected.discover());
        require(!rejected.frame(1, 2, 3)); rejected.release(); require(invalid.writes.empty());
    }
    Keyboard malformed([](const auto&, auto& r) { r.fill(255); return true; });
    require(!malformed.discover());
    Keyboard disconnected([](const auto&, auto&) { return false; });
    require(!disconnected.discover());
    Fake lost_ack;
    Keyboard recover([&](const auto& p, auto& r) {
        const bool result = lost_ack.exchange(p, r);
        return result && p[0] != 7; // The device applied the color but its ACK was lost.
    });
    const auto before = lost_ack.current;
    require(recover.discover()); require(!recover.frame(255, 0, 0));
    recover.release();
    require(std::equal(before.begin()+2, before.begin()+8, lost_ack.current.begin()+2));
    std::cout << "VialRGB discovery, volatile frames, restore, rejection: OK\n";
}
