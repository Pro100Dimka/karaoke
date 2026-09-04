#pragma once
#include <algorithm>
#include <cmath>
#include <vector>
namespace lamp_zones {
inline std::vector<unsigned> assign(const std::vector<float>& positions, float width) {
    std::vector<unsigned> result;
    result.reserve(positions.size());
    const bool spatial = std::isfinite(width) && width > 0.001F &&
        std::any_of(positions.begin(), positions.end(), [](float value) { return std::abs(value) > 0.001F; });
    for (size_t index = 0; index < positions.size(); ++index) {
        const float normalized = spatial
            ? std::clamp(positions[index] / width, 0.0F, 0.999999F)
            : (positions.size() > 1 ? float(index) / float(positions.size()) : 0.5F);
        result.push_back(std::min(4U, static_cast<unsigned>(normalized * 5.0F)));
    }
    return result;
}
}
