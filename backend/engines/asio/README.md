# Karaoke ASIO bridge

`KaraokeAsioBridge` is a separate x64 process for direct ASIO full-duplex
monitoring. It uses the GPLv3 option of the Steinberg ASIO SDK stored in
`sdk/`; distributed builds must comply with GPLv3 unless a proprietary
Steinberg ASIO SDK agreement is obtained.

Build on Windows:

```bat
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
cmake -S backend\engines\asio -B backend\engines\asio\build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build backend\engines\asio\build --config Release
```

Probe the installed ASIO drivers:

```bat
KaraokeAsioBridge.exe --list
```
