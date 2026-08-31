# Unmodified SDK sources and licenses are also shipped with the addon.
set(LIGHTING_CACHE "${CMAKE_CURRENT_SOURCE_DIR}/../../../../downloads/engines/lighting")
file(MAKE_DIRECTORY "${LIGHTING_CACHE}" "${CMAKE_CURRENT_BINARY_DIR}/sources")
function(lighting_source name url sha dirname)
  set(archive "${LIGHTING_CACHE}/${name}.zip")
  if(EXISTS "${archive}")
    file(SHA256 "${archive}" actual)
    if(NOT actual STREQUAL sha)
      message(FATAL_ERROR "Lighting dependency hash mismatch: ${name}")
    endif()
  else()
    file(DOWNLOAD "${url}" "${archive}" EXPECTED_HASH "SHA256=${sha}" TLS_VERIFY ON)
  endif()
  file(ARCHIVE_EXTRACT INPUT "${archive}" DESTINATION "${LIGHTING_CACHE}")
  configure_file("${archive}" "${CMAKE_CURRENT_BINARY_DIR}/sources/${name}.zip" COPYONLY)
  set(${name}_ROOT "${LIGHTING_CACHE}/${dirname}" PARENT_SCOPE)
endfunction()
lighting_source(wooting-v1.8.0
  "https://codeload.github.com/WootingKb/wooting-rgb-sdk/zip/refs/tags/v1.8.0"
  "924040f8eb2223dcd33db7171919afe5af2e2545ee500a7bc38dedc907c606f8"
  "wooting-rgb-sdk-1.8.0")
lighting_source(hidapi-d3013f0
  "https://codeload.github.com/libusb/hidapi/zip/d3013f0af3f4029d82872c1a9487ea461a56dee4"
  "4ccc47afdd2fcbbdfb97d65be4484b2c927921898e0c3b1bf7c1799172a5555c"
  "hidapi-d3013f0af3f4029d82872c1a9487ea461a56dee4")
add_library(wooting_rgb STATIC
  "${wooting-v1.8.0_ROOT}/src/wooting-rgb-sdk.c"
  "${wooting-v1.8.0_ROOT}/src/wooting-usb.c"
  "${hidapi-d3013f0_ROOT}/windows/hid.c")
target_compile_definitions(wooting_rgb PUBLIC WOOTINGRGBSDK_EXPORTS)
target_include_directories(wooting_rgb PUBLIC "${wooting-v1.8.0_ROOT}/src" "${hidapi-d3013f0_ROOT}/hidapi")
target_link_libraries(wooting_rgb PUBLIC setupapi)
set_target_properties(wooting_rgb PROPERTIES MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
configure_file("${wooting-v1.8.0_ROOT}/LICENSE" "${CMAKE_CURRENT_BINARY_DIR}/sources/LICENSE-Wooting.txt" COPYONLY)
configure_file("${hidapi-d3013f0_ROOT}/LICENSE-bsd.txt" "${CMAKE_CURRENT_BINARY_DIR}/sources/LICENSE-HIDAPI.txt" COPYONLY)
