#include "lamp_zones.h"
#include <stdexcept>
#include <vector>
static void require(bool value) { if (!value) throw std::runtime_error("Lamp zone test failed"); }
int main() {
    const auto positioned = lamp_zones::assign({0.F, 24.F, 49.F, 75.F, 100.F}, 100.F);
    require(positioned == std::vector<unsigned>({0, 1, 2, 3, 4}));
    const auto keys = lamp_zones::assign({0.F, 10.F, 20.F, 30.F, 40.F, 50.F}, 50.F);
    require(keys.front() == 0 && keys.back() == 4);
    const auto fallback = lamp_zones::assign({0.F, 0.F, 0.F, 0.F, 0.F}, 0.F);
    require(fallback == std::vector<unsigned>({0, 1, 2, 3, 4}));
}
