import { describe, expect, it } from "vitest";

import {
  createDiscoveryResponse,
  parseDiscoveryRequest,
  pickDiscoveryHost,
  shouldStartMobileDiscovery,
} from "./discoveryProtocol";

describe("mobile discovery protocol", () => {
  it("parses valid discovery requests", () => {
    expect(parseDiscoveryRequest('{"kind":"t3-mobile-discovery","version":1}')).toEqual({
      kind: "t3-mobile-discovery",
      version: 1,
    });
  });

  it("rejects unknown discovery requests", () => {
    expect(parseDiscoveryRequest('{"kind":"wrong","version":1}')).toBeNull();
    expect(parseDiscoveryRequest("nope")).toBeNull();
  });

  it("prefers public host over inferred interfaces", () => {
    const host = pickDiscoveryHost(
      { host: "0.0.0.0", publicHost: "my-mac.ts.net" },
      "100.64.0.20",
      {
        en0: [
          {
            address: "192.168.1.40",
            family: "IPv4",
            internal: false,
            mac: "",
            netmask: "",
            cidr: "",
          },
        ],
      },
    );

    expect(host).toBe("my-mac.ts.net");
  });

  it("prefers an interface on the same subnet as the requester", () => {
    const host = pickDiscoveryHost({ host: undefined, publicHost: undefined }, "192.168.1.70", {
      en0: [
        { address: "10.0.0.4", family: "IPv4", internal: false, mac: "", netmask: "", cidr: "" },
      ],
      en1: [
        {
          address: "192.168.1.40",
          family: "IPv4",
          internal: false,
          mac: "",
          netmask: "",
          cidr: "",
        },
      ],
    });

    expect(host).toBe("192.168.1.40");
  });

  it("skips discovery when only loopback is configured", () => {
    expect(shouldStartMobileDiscovery({ host: "127.0.0.1", publicHost: undefined })).toBe(false);
    expect(shouldStartMobileDiscovery({ host: "localhost", publicHost: undefined })).toBe(false);
  });

  it("builds a discovery response with a reachable base url", () => {
    const response = createDiscoveryResponse(
      {
        cwd: "/tmp/t3code",
        host: undefined,
        publicHost: undefined,
        port: 3773,
      },
      "192.168.1.70",
      "MacBook-Pro",
      {
        en0: [
          {
            address: "192.168.1.40",
            family: "IPv4",
            internal: false,
            mac: "",
            netmask: "",
            cidr: "",
          },
        ],
      },
    );

    expect(response).toEqual({
      kind: "t3-mobile-discovery-response",
      version: 1,
      server: {
        id: "MacBook-Pro:3773",
        name: "MacBook-Pro (t3code)",
        host: "192.168.1.40",
        port: 3773,
        baseUrl: "http://192.168.1.40:3773",
      },
    });
  });
});
