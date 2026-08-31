#pragma once
#include <cstdint>
#include <string>
struct UsbLightingStatus { uint32_t count = 0; std::string state = "no_devices"; };
UsbLightingStatus usb_lighting_request(int action, int r, int g, int b);
