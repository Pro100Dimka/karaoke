#include "winbond_protocol.h"
#include <iostream>
#include <stdexcept>
#include <vector>
using namespace winbond_lighting;
void require(bool ok) { if (!ok) throw std::runtime_error("Winbond protocol assertion failed"); }
struct Fake {
    Packet version{1,0x0d}, modes{1,0x0a,0,0,0,17,0,1,2,3,4,5,6,7,8,9,10,11,12,0xa5,0x5a,5,5};
    std::vector<Packet> writes;
    int fail_write = -1, stream_write = 0;
    Fake() { std::string v = "2NUC,01,KB,FL,K188BRGB,V1.05.04"; std::copy(v.begin(),v.end(),version.begin()+5); }
    Keyboard keyboard() { return Keyboard([&](const auto& p) {
        require(p[1] == 0x17 || p[1] == 0x0f); writes.push_back(p);
        return !(p[1] == 0x0f && stream_write++ == fail_write);
    }, [&](uint8_t cmd, auto& p) { p = cmd == 0x0d ? version : modes; return true; }); }
};
int main() {
    require(endpoint(0x416,0xb23c,0xff1b,0x91,2));
    require(!endpoint(0x416,0xb23c,1,6,0));
    require(!endpoint(0x416,0xb23c,0xff1b,0x91,1));
    Fake f; auto k=f.keyboard();
    require(!k.frame(1,2,3)); require(k.discover()); require(f.writes.empty());
    require(k.frame(12,25,255)); require(f.writes.size()==11); require(f.writes[0]==sync(true));
    for (unsigned i=0;i<8;++i) {
        const auto& p=f.writes[i+1]; require(p[0]==1 && p[1]==15 && p[2]==0 && p[3]==0 && p[4]==i);
        require(p[5]==(i==7 ? 18 : 54));
        for (unsigned at=6;at<6u+p[5];at+=3) require(p[at]==12 && p[at+1]==25 && p[at+2]==255);
        for (unsigned at=6+p[5];at<64;++at) require(p[at]==0);
    }
    for (unsigned i=0;i<2;++i) {
        const auto& p=f.writes[9+i]; require(p[0]==1 && p[1]==15 && p[2]==1 && p[3]==0 && p[4]==i);
        require(p[5]==(i==0 ? 54 : 45));
        for (unsigned at=6;at<64;++at) require(p[at]==0);
    }
    require(k.frame(0,0,0)); require(f.writes.size()==21);
    k.release(); require(f.writes.back()==sync(false));
    k.release(); require(f.writes.size()==22);
    for (int index=0;index<10;++index) {
        Fake broken; broken.fail_write=index; auto failed=broken.keyboard(); require(failed.discover());
        require(!failed.frame(1,2,3)); require(broken.writes.back()==sync(false));
    }
    for (int kind=0;kind<4;++kind) {
        Fake bad;
        if(kind==0) bad.version[5]='X';
        if(kind==1) bad.modes[5]=255;
        if(kind==2) bad.modes[19]=0;
        if(kind==3) bad.version[18]='X';
        auto rejected=bad.keyboard(); require(!rejected.discover()); require(!rejected.frame(1,2,3));
        rejected.release(); require(bad.writes.empty());
    }
    std::cout << "Winbond identity, stream packets, no-save commands, release, failure cleanup: OK\n";
}
