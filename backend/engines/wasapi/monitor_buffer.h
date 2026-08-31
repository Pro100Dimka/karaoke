#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <stdexcept>
#include <vector>

namespace shared_audio {
inline uint32_t engine_period(uint32_t requested, uint32_t minimum, uint32_t maximum, uint32_t fundamental) {
    if (!requested || !fundamental || minimum > maximum)
        throw std::runtime_error("Invalid shared engine periods");
    const uint64_t wanted = std::max(requested, minimum);
    const uint64_t legal = (wanted + fundamental - 1) / fundamental * fundamental;
    if (legal > maximum) throw std::runtime_error("Requested buffer exceeds the shared engine maximum");
    return static_cast<uint32_t>(legal);
}
inline float decode(const uint8_t* data, unsigned bits, bool floating) {
    if (floating) { float value; std::memcpy(&value, data, 4); return std::isfinite(value) ? value : 0; }
    if (bits == 16) { int16_t value; std::memcpy(&value, data, 2); return value / 32768.0F; }
    if (bits == 32) { int32_t value; std::memcpy(&value, data, 4); return static_cast<float>(value / 2147483648.0); }
    int32_t value = int32_t(data[0]) | (int32_t(data[1]) << 8) | (int32_t(data[2]) << 16);
    if (value & 0x800000) value -= 0x1000000;
    return value / 8388608.0F;
}
inline void encode(uint8_t* data, unsigned bits, bool floating, float input) {
    const float value = std::isfinite(input) ? std::clamp(input, -.985F, .985F) : 0;
    if (floating) { std::memcpy(data, &value, 4); return; }
    if (bits == 16) { const auto pcm = static_cast<int16_t>(value * 32767); std::memcpy(data, &pcm, 2); return; }
    if (bits == 32) { const auto pcm = static_cast<int32_t>(double(value) * 2147483647); std::memcpy(data, &pcm, 4); return; }
    const auto pcm = static_cast<int32_t>(value * 8388607);
    for (unsigned i = 0; i < 3; ++i) data[i] = static_cast<uint8_t>((static_cast<uint32_t>(pcm) >> (i * 8)) & 255);
}
// Single-threaded, preallocated queue. Independent device rates are converted
// without accumulating an unbounded backlog; underruns never repeat old audio.
class MonitorBuffer {
    std::vector<float> samples;
    std::vector<double> timestamps;
    size_t head = 0, used = 0;
    uint64_t lost = 0;
    double ratio, phase = 0;
public:
    MonitorBuffer(size_t capacity, double rate_ratio) : samples(capacity), timestamps(capacity), ratio(rate_ratio) {
        if (capacity < 2 || !std::isfinite(ratio) || ratio <= 0) throw std::runtime_error("Invalid monitor queue");
    }
    size_t size() const { return used; }
    size_t available() const {
        if (ratio == 1) return used;
        if (used < 2) return 0;
        // Interpolation needs a following source sample, even when the byte
        // count alone suggests another output frame would fit.
        const double interpolated = std::ceil((used - 1 - phase) / ratio - 1e-9);
        const double advanced = std::floor((used - phase) / ratio + 1e-9);
        return static_cast<size_t>(std::max(0.0, std::min(interpolated, advanced)));
    }
    uint64_t dropped() const { return lost; }
    void push(const float* input, size_t count, double captured_at = 0, double step = 0) {
        for (size_t i = 0; i < count; ++i) {
            if (used == samples.size()) { head = (head + 1) % samples.size(); --used; ++lost; phase = 0; }
            const size_t index = (head + used++) % samples.size();
            samples[index] = input[i];
            timestamps[index] = captured_at > 0 ? captured_at + i * step : 0;
        }
    }
    bool pop(float& output, double* captured_at = nullptr) {
        if (captured_at) *captured_at = 0;
        if (ratio == 1 && used) {
            output = samples[head];
            if (captured_at) *captured_at = timestamps[head];
            head = (head + 1) % samples.size(); --used; return true;
        }
        const size_t consume = static_cast<size_t>(phase + ratio);
        if (used < std::max<size_t>(2, consume)) { output = 0; return false; }
        output = static_cast<float>(samples[head] * (1 - phase) + samples[(head + 1) % samples.size()] * phase);
        const double first = timestamps[head], second = timestamps[(head + 1) % samples.size()];
        if (captured_at && first > 0 && second > 0) *captured_at = first * (1 - phase) + second * phase;
        phase += ratio - consume;
        head = (head + consume) % samples.size();
        used -= consume;
        return true;
    }
};
}
