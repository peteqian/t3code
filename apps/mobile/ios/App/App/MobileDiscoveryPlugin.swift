import Foundation
import Capacitor

private let discoveryPort: UInt16 = 37731

private struct DiscoveryRequest: Encodable {
    let kind = "t3-mobile-discovery"
    let version = 1
}

private struct DiscoveredServer: Decodable {
    let id: String
    let name: String
    let host: String
    let port: Int
    let baseUrl: String
}

private struct DiscoveryResponse: Decodable {
    let kind: String
    let version: Int
    let server: DiscoveredServer
}

@objc(MobileDiscoveryPlugin)
public class MobileDiscoveryPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MobileDiscoveryPlugin"
    public let jsName = "MobileDiscovery"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise)
    ]

    @objc func scan(_ call: CAPPluginCall) {
        let timeoutMs = call.getInt("timeoutMs") ?? 1200

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let servers = try self.scanServers(timeoutMs: timeoutMs)
                let payload = servers.map { server in
                    [
                        "id": server.id,
                        "name": server.name,
                        "host": server.host,
                        "port": server.port,
                        "baseUrl": server.baseUrl,
                    ] as [String : Any]
                }
                call.resolve([
                    "servers": payload,
                ])
            } catch {
                call.reject("Failed to scan for nearby T3 servers.", nil, error)
            }
        }
    }

    private func scanServers(timeoutMs: Int) throws -> [DiscoveredServer] {
        let socketFd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
        if socketFd < 0 {
            throw NSError(domain: "MobileDiscovery", code: Int(errno), userInfo: nil)
        }

        defer {
            close(socketFd)
        }

        var allowBroadcast: Int32 = 1
        if setsockopt(
            socketFd,
            SOL_SOCKET,
            SO_BROADCAST,
            &allowBroadcast,
            socklen_t(MemoryLayout<Int32>.size)
        ) < 0 {
            throw NSError(domain: "MobileDiscovery", code: Int(errno), userInfo: nil)
        }

        var timeout = timeval(
            tv_sec: timeoutMs / 1000,
            tv_usec: __darwin_suseconds_t((timeoutMs % 1000) * 1000)
        )
        if setsockopt(
            socketFd,
            SOL_SOCKET,
            SO_RCVTIMEO,
            &timeout,
            socklen_t(MemoryLayout<timeval>.size)
        ) < 0 {
            throw NSError(domain: "MobileDiscovery", code: Int(errno), userInfo: nil)
        }

        var bindAddress = sockaddr_in()
        bindAddress.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        bindAddress.sin_family = sa_family_t(AF_INET)
        bindAddress.sin_port = in_port_t(0).bigEndian
        bindAddress.sin_addr = in_addr(s_addr: INADDR_ANY.bigEndian)

        let bindResult = withUnsafePointer(to: &bindAddress) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { reboundPointer in
                bind(socketFd, reboundPointer, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        if bindResult < 0 {
            throw NSError(domain: "MobileDiscovery", code: Int(errno), userInfo: nil)
        }

        let requestData = try JSONEncoder().encode(DiscoveryRequest())
        var targetAddress = sockaddr_in()
        targetAddress.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        targetAddress.sin_family = sa_family_t(AF_INET)
        targetAddress.sin_port = discoveryPort.bigEndian
        targetAddress.sin_addr = in_addr(s_addr: INADDR_BROADCAST.bigEndian)

        let sentCount = requestData.withUnsafeBytes { rawBuffer in
            withUnsafePointer(to: &targetAddress) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { reboundPointer in
                    sendto(
                        socketFd,
                        rawBuffer.baseAddress,
                        rawBuffer.count,
                        0,
                        reboundPointer,
                        socklen_t(MemoryLayout<sockaddr_in>.size)
                    )
                }
            }
        }
        if sentCount < 0 {
            throw NSError(domain: "MobileDiscovery", code: Int(errno), userInfo: nil)
        }

        var discoveredById: [String: DiscoveredServer] = [:]

        while true {
            var buffer = [UInt8](repeating: 0, count: 2048)
            var remoteAddress = sockaddr_in()
            var remoteAddressLength = socklen_t(MemoryLayout<sockaddr_in>.size)

            let receivedCount = buffer.withUnsafeMutableBytes { rawBuffer in
                withUnsafeMutablePointer(to: &remoteAddress) { pointer in
                    pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { reboundPointer in
                        recvfrom(
                            socketFd,
                            rawBuffer.baseAddress,
                            rawBuffer.count,
                            0,
                            reboundPointer,
                            &remoteAddressLength
                        )
                    }
                }
            }

            if receivedCount < 0 {
                if errno == EWOULDBLOCK || errno == EAGAIN {
                    break
                }

                throw NSError(domain: "MobileDiscovery", code: Int(errno), userInfo: nil)
            }

            let data = Data(buffer.prefix(receivedCount))
            guard let response = try? JSONDecoder().decode(DiscoveryResponse.self, from: data) else {
                continue
            }
            guard response.kind == "t3-mobile-discovery-response", response.version == 1 else {
                continue
            }

            discoveredById[response.server.id] = response.server
        }

        return discoveredById.values.sorted { left, right in
            if left.name == right.name {
                return left.baseUrl < right.baseUrl
            }
            return left.name < right.name
        }
    }
}
