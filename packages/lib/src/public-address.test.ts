/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  isPublicAddress,
  publicAddress,
  type Resolve,
  reachable,
} from "./public-address.js";

describe("which addresses a server may reach", () => {
  // Every special-purpose range in IANA's IPv4 and IPv6 registries that is
  // not globally reachable, and every IPv6 form that can carry an IPv4
  // address, which is judged by that address or refused outright.
  const ADDRESSES: [address: string, reachable: boolean, why: string][] = [
    ["93.184.215.14", true, "public IPv4"],
    ["8.8.8.8", true, "public IPv4"],
    ["172.32.0.1", true, "just past 172.16/12"],
    ["0.0.0.0", false, "this network"],
    ["10.1.2.3", false, "private"],
    ["100.64.0.1", false, "shared address space"],
    ["127.0.0.1", false, "loopback"],
    ["169.254.169.254", false, "link-local, the metadata service"],
    ["172.16.5.4", false, "private"],
    ["172.31.255.255", false, "private"],
    ["192.0.0.8", false, "IETF protocol assignments"],
    ["192.0.2.1", false, "documentation"],
    ["192.88.99.1", false, "deprecated 6to4 relay anycast"],
    ["192.168.1.1", false, "private"],
    ["198.18.0.1", false, "benchmarking"],
    ["198.51.100.1", false, "documentation"],
    ["203.0.113.1", false, "documentation"],
    ["224.0.0.1", false, "multicast"],
    ["240.0.0.1", false, "reserved"],
    ["255.255.255.255", false, "broadcast"],
    ["2606:4700:4700::1111", true, "public IPv6"],
    ["2001:4860:4860::8888", true, "public IPv6 in 2001::/16"],
    ["::ffff:8.8.8.8", true, "IPv4-mapped, public inside"],
    ["64:ff9b::808:808", true, "NAT64, public inside"],
    ["::", false, "unspecified"],
    ["::1", false, "loopback"],
    ["::ffff:127.0.0.1", false, "IPv4-mapped loopback"],
    ["::ffff:a9fe:a9fe", false, "IPv4-mapped metadata"],
    ["64:ff9b::a9fe:a9fe", false, "NAT64 metadata"],
    ["::7f00:1", false, "IPv4-compatible"],
    ["::127.0.0.1", false, "IPv4-compatible, dotted"],
    ["::808:808", false, "IPv4-compatible, even public inside"],
    ["::ffff:0:7f00:1", false, "SIIT, IPv4-translated"],
    ["::ffff:0:808:808", false, "SIIT, even public inside"],
    ["64:ff9b:1::7f00:1", false, "local-use NAT64"],
    ["64:ff9b:1::808:808", false, "local-use NAT64, even public inside"],
    ["100::1", false, "discard-only"],
    ["2001::1", false, "Teredo"],
    ["2001:0:4136:e378:8000:63bf:3fff:fdd2", false, "Teredo"],
    ["2001:2::1", false, "benchmarking"],
    ["2001:20::1", false, "ORCHIDv2"],
    ["2001:db8::1", false, "documentation"],
    ["2002:7f00:1::1", false, "6to4"],
    ["2002:808:808::1", false, "6to4, even public inside"],
    ["3fff::1", false, "documentation"],
    ["5f00::1", false, "SRv6 SIDs"],
    ["fc00::1", false, "unique local"],
    ["fd00:ec2::254", false, "unique local, the metadata service"],
    ["fe80::1", false, "link-local"],
    ["fe80::1%en0", false, "link-local, scoped"],
    ["fec0::1", false, "site-local"],
    ["ff02::1", false, "multicast"],
    ["not an address", false, "not an address"],
  ];

  for (const [address, reachable, why] of ADDRESSES)
    test(`${address}: ${why}`, () => {
      expect(isPublicAddress(address)).toBe(reachable);
    });
});

describe("where a URL may lead a server", () => {
  const lookups: string[] = [];
  const resolveTo =
    (...addresses: string[]): Resolve =>
    async (host: string) => {
      lookups.push(host);
      return addresses.map((address) => ({
        address,
        family: address.includes(":") ? 6 : 4,
      }));
    };
  const where = async (src: string, resolve = resolveTo("93.184.215.14")) => {
    const url = reachable(src);
    return url && publicAddress(url, resolve);
  };

  test("a public host, at an address it resolves to", async () => {
    expect(await where("https://news.example/post")).toEqual({
      address: "93.184.215.14",
      family: 4,
    });
  });

  // The URL parser reads every way of writing an IPv4 address, so each is
  // judged by the address it names.
  for (const src of [
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.1/",
    "http://172.16.0.1/",
    "http://172.31.255.254/",
    "http://192.168.0.1/",
    "http://[fc00::1]/",
    "http://[fdff::1]/",
    "http://[fe80::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:169.254.169.254]/",
    "http://2130706433/",
    "http://0x7f000001/",
    "http://0xa9fea9fe/",
    "http://0251.0376.0251.0376/",
    "http://127.1/",
    "http://localhost:3000/",
    "http://LOCALHOST./",
    "http://api.localhost/",
  ])
    test(`not ${src}, which is private however it is written`, async () => {
      lookups.length = 0;
      expect(await where(src)).toBeUndefined();
      expect(lookups).toEqual([]);
    });

  for (const inside of [
    "10.0.0.7",
    "169.254.169.254",
    "fe80::1",
    "::ffff:10.0.0.1",
  ])
    test(`not a host that resolves to ${inside}, even beside a public address`, async () => {
      expect(
        await where(
          "https://intranet.example/",
          resolveTo("93.184.215.14", inside),
        ),
      ).toBeUndefined();
    });

  test("not a host that resolves to nothing", async () => {
    expect(await where("https://gone.example/", resolveTo())).toBeUndefined();
  });

  test("nowhere but plain http(s), and never with credentials", () => {
    for (const src of [
      "file:///etc/passwd",
      "data:text/html,hi",
      "ftp://news.example/",
      "gopher://news.example/",
      "https://user:secret@news.example/",
      "/relative",
    ])
      expect(reachable(src)).toBeUndefined();
  });
});
