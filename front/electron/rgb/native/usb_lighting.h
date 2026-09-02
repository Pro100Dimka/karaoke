#pragma once
#include <array>
#include <cstdint>
#include <string>
struct UsbLightingStatus { uint32_t count = 0; std::string state = "no_devices"; };
UsbLightingStatus usb_lighting_request(int action, const std::array<int, 15>& colors);
