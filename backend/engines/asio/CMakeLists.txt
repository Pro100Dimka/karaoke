cmake_minimum_required(VERSION 3.24)
project(KaraokeAsioBridge LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

set(ASIO_SDK_DIR "${CMAKE_CURRENT_SOURCE_DIR}/sdk")

add_executable(KaraokeAsioBridge
  bridge_main.cpp
  ${ASIO_SDK_DIR}/common/asio.cpp
  ${ASIO_SDK_DIR}/host/asiodrivers.cpp
  ${ASIO_SDK_DIR}/host/pc/asiolist.cpp
)

target_include_directories(KaraokeAsioBridge PRIVATE
  ${ASIO_SDK_DIR}/common
  ${ASIO_SDK_DIR}/host
  ${ASIO_SDK_DIR}/host/pc
)
target_compile_definitions(KaraokeAsioBridge PRIVATE _CRT_SECURE_NO_WARNINGS NOMINMAX)
target_link_libraries(KaraokeAsioBridge PRIVATE ole32)
