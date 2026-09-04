#include "logitech_g213_protocol.h"
#include <cassert>

int main() {
    using namespace logitech_g213_lighting;

    assert(endpoint(0x046d, 0xc336, 0xff43, 0x0602, 1));
    assert(!endpoint(0x046d, 0xc336, 0x0001, 0x0006, 0));
    assert(!endpoint(0x046d, 0xc335, 0xff43, 0x0602, 1));

    const auto packet = direct(3, 0x12, 0x34, 0x56);
    assert(packet.size() == 20);
    assert(packet[0] == 0x11 && packet[1] == 0xff);
    assert(packet[2] == 0x0c && packet[3] == 0x3a);
    assert(packet[4] == 3 && packet[5] == 1);
    assert(packet[6] == 0x12 && packet[7] == 0x34 && packet[8] == 0x56);
    assert(packet[9] == 2);

    assert(direct(0, 1, 2, 3) == Packet{});
    assert(direct(6, 1, 2, 3) == Packet{});
}
