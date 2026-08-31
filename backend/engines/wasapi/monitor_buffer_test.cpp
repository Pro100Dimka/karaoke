#include "monitor_buffer.h"
#include <iostream>
#include <limits>
using namespace shared_audio;
static void verify(bool condition) { if (!condition) throw std::runtime_error("Native audio test failed"); }
int main() {
    verify(engine_period(64, 48, 480, 48) == 96);
    verify(engine_period(64, 441, 441, 441) == 441);
    verify(engine_period(128, 32, 1024, 32) == 128);
    bool rejected = false;
    try { engine_period(2048, 48, 480, 48); } catch (const std::exception&) { rejected = true; }
    verify(rejected);
    for (unsigned bits : {16, 24, 32}) for (float value : {-.9F, 0.0F, .9F}) {
        uint8_t data[4]{};
        encode(data, bits, false, value);
        verify(std::abs(decode(data, bits, false) - value) < .0001);
    }
    uint8_t data[4]{};
    encode(data, 32, true, std::numeric_limits<float>::quiet_NaN());
    verify(decode(data, 32, true) == 0);
    const float source[] = {1, 2, 3, 4, 5, 6};
    MonitorBuffer direct(4, 1);
    direct.push(source, 6);
    verify(direct.size() == 4 && direct.dropped() == 2);
    float result = 0;
    for (float expected : {3, 4, 5, 6}) { verify(direct.pop(result)); verify(result == expected); }
    verify(!direct.pop(result) && result == 0);
    MonitorBuffer upsample(16, .5);
    upsample.push(source, 6);
    for (float expected : {1.0F, 1.5F, 2.0F, 2.5F}) { verify(upsample.pop(result)); verify(result == expected); }
    MonitorBuffer downsample(16, 2);
    downsample.push(source, 6);
    for (float expected : {1, 3, 5}) { verify(downsample.pop(result)); verify(result == expected); }
    verify(!downsample.pop(result));
    for (double ratio : {44100.0 / 48000.0, 48000.0 / 44100.0, .5, 2.0}) {
        MonitorBuffer converted(2048, ratio);
        float packet[441]{};
        for (unsigned i = 0; i < 2000; ++i) {
            converted.push(packet, 441, 10.0 + i * .01, 1.0 / 44100);
            const size_t ready = converted.available();
            for (size_t frame = 0; frame < ready; ++frame) {
                double timestamp = 0;
                verify(converted.pop(result, &timestamp));
                verify(timestamp >= 10.0);
            }
            verify(converted.size() <= 2);
        }
        verify(converted.dropped() == 0);
    }
    // Long mismatched-clock simulation must remain bounded, never accumulating
    // seconds of old microphone audio when render misses a wake-up.
    MonitorBuffer bounded(256, 44100.0 / 48000.0);
    float block[64]{};
    for (int tick = 0; tick < 10000; ++tick) {
        bounded.push(block, 64);
        for (int frame = 0; frame < 60; ++frame) bounded.pop(result);
        verify(bounded.size() <= 256);
    }
    std::cout << "Native shared audio tests passed: periods, PCM/float, saturation, bounded queue, underrun, resampling\n";
}
