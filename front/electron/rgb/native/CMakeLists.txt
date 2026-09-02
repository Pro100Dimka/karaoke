cmake_minimum_required(VERSION 3.20)
project(KeyboardLighting LANGUAGES C CXX)
if(NOT WIN32)
  return()
endif()
set(NODE_HEADERS "${CMAKE_CURRENT_SOURCE_DIR}/../../../../downloads/engines/node-api-headers")
foreach(header node_api.h node_api_types.h js_native_api.h js_native_api_types.h)
  if(NOT EXISTS "${NODE_HEADERS}/${header}")
    message(FATAL_ERROR "Vendored Node-API header is missing: ${NODE_HEADERS}/${header}")
  endif()
endforeach()
include(${CMAKE_CURRENT_SOURCE_DIR}/dependencies.cmake)
add_library(KeyboardLighting SHARED
  lighting.cpp
  usb_lighting.cpp
  usb_lighting.h
  logitech_g213_protocol.h
  vial_protocol.h
  winbond_protocol.h
)
# This toolchain emits unscanned MSVC Ninja rules, so make local header
# dependencies explicit. Otherwise a protocol-only edit can leave a stale
# KeyboardLighting.node while rebuilding only the test executable.
set_property(SOURCE lighting.cpp APPEND PROPERTY OBJECT_DEPENDS
  "${CMAKE_CURRENT_SOURCE_DIR}/usb_lighting.h;${CMAKE_CURRENT_SOURCE_DIR}/lamp_zones.h"
)
set_property(SOURCE usb_lighting.cpp APPEND PROPERTY OBJECT_DEPENDS
  "${CMAKE_CURRENT_SOURCE_DIR}/usb_lighting.h;${CMAKE_CURRENT_SOURCE_DIR}/logitech_g213_protocol.h;${CMAKE_CURRENT_SOURCE_DIR}/vial_protocol.h;${CMAKE_CURRENT_SOURCE_DIR}/winbond_protocol.h"
)
target_compile_features(KeyboardLighting PRIVATE cxx_std_17)
target_include_directories(KeyboardLighting PRIVATE "${NODE_HEADERS}")
target_link_libraries(KeyboardLighting PRIVATE windowsapp ole32 wooting_rgb)
set_target_properties(KeyboardLighting PROPERTIES PREFIX "" SUFFIX ".node" MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
enable_testing()
add_executable(LightingProtocolTests vial_protocol_test.cpp)
set_property(SOURCE vial_protocol_test.cpp APPEND PROPERTY OBJECT_DEPENDS
  "${CMAKE_CURRENT_SOURCE_DIR}/vial_protocol.h"
)
target_compile_features(LightingProtocolTests PRIVATE cxx_std_17)
add_test(NAME lighting-protocol COMMAND LightingProtocolTests)
add_executable(WinbondProtocolTests winbond_protocol_test.cpp)
set_property(SOURCE winbond_protocol_test.cpp APPEND PROPERTY OBJECT_DEPENDS
  "${CMAKE_CURRENT_SOURCE_DIR}/winbond_protocol.h"
)
target_compile_features(WinbondProtocolTests PRIVATE cxx_std_17)
add_test(NAME winbond-protocol COMMAND WinbondProtocolTests)
add_executable(LampZoneTests lamp_zones_test.cpp)
target_compile_features(LampZoneTests PRIVATE cxx_std_17)
add_test(NAME lamp-zones COMMAND LampZoneTests)
add_executable(LogitechG213ProtocolTests logitech_g213_protocol_test.cpp)
target_compile_features(LogitechG213ProtocolTests PRIVATE cxx_std_17)
add_test(NAME logitech-g213-protocol COMMAND LogitechG213ProtocolTests)
