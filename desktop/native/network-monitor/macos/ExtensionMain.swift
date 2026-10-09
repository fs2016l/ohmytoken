import Foundation
import NetworkExtension
import SystemExtensions

@main
enum NetworkExtensionMain {
    static func main() {
        NEProvider.startSystemExtensionMode()
        dispatchMain()
    }
}
