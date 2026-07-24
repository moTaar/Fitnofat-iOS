import SwiftUI

// MARK: - Billing View

struct BillingView: View {
    @StateObject private var billingStore = BillingStore.shared
    @State private var selectedPlan: String = "pro"
    @State private var isLoading = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    // Header
                    VStack(spacing: 8) {
                        Image(systemName: "crown.fill")
                            .font(.system(size: 50))
                            .foregroundColor(.yellow)
                        Text("Upgrade to Pro")
                            .font(.title)
                            .bold()
                        Text("Unlock all features and take your training to the next level.")
                            .font(.body)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.top)

                    // Plan comparison
                    VStack(spacing: 0) {
                        // Free tier
                        planRow(
                            name: "Free",
                            price: "$0",
                            features: [
                                "Basic workout tracking",
                                "Exercise library",
                                "Workout history",
                            ],
                            isPro: false
                        )

                        Divider()

                        // Pro tier
                        planRow(
                            name: "Pro",
                            price: "$9.99/mo",
                            features: [
                                "Everything in Free",
                                "AI Coach with image analysis",
                                "AI nutrition planning",
                                "AI program generation & refresh",
                                "AI exercise assistance",
                                "Personalized recommendations",
                            ],
                            isPro: true
                        )
                    }
                    .background(Color(.systemGray6))
                    .cornerRadius(12)
                    .padding(.horizontal)

                    // Subscribe button
                    Button(action: subscribe) {
                        if isLoading {
                            ProgressView()
                                .tint(.white)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                        } else {
                            Text("Subscribe to Pro")
                                .font(.headline)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(LinearGradient(colors: [.yellow, .orange], startPoint: .leading, endPoint: .trailing).toColor ?? .orange)
                    .disabled(isLoading)
                    .padding(.horizontal)

                    if billingStore.isEntitled(to: .aiCoach) {
                        Button(action: manageBilling) {
                            Text("Manage Subscription")
                                .font(.subheadline)
                        }
                        .disabled(isLoading)
                    }

                    if let error = error {
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.red)
                    }

                    Spacer()
                }
                .padding(.vertical)
            }
            .navigationTitle("Billing")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private func planRow(name: String, price: String, features: [String], isPro: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(name)
                    .font(.title3)
                    .bold()
                Spacer()
                Text(price)
                    .font(.title3)
                    .bold()
                    .foregroundColor(isPro ? .yellow : .primary)
            }

            ForEach(features, id: \.self) { feature in
                HStack(spacing: 8) {
                    Image(systemName: isPro ? "checkmark.circle.fill" : "checkmark.circle")
                        .foregroundColor(isPro ? .green : .secondary)
                        .font(.caption)
                    Text(feature)
                        .font(.subheadline)
                        .foregroundColor(isPro || features.firstIndex(of: feature)! < 3 ? .primary : .secondary)
                }
            }
        }
        .padding()
    }

    private func subscribe() {
        isLoading = true
        error = nil

        Task {
            do {
                let url = try await billingStore.startCheckout(plan: selectedPlan)
                // Open URL via system
                if let url = URL(string: url) {
                    #if os(iOS)
                    UIApplication.shared.open(url)
                    #endif
                }
            } catch {
                self.error = error.localizedDescription
            }
            isLoading = false
        }
    }

    private func manageBilling() {
        isLoading = true
        error = nil

        Task {
            do {
                let url = try await billingStore.openPortal()
                if let url = URL(string: url) {
                    #if os(iOS)
                    UIApplication.shared.open(url)
                    #endif
                }
            } catch {
                self.error = error.localizedDescription
            }
            isLoading = false
        }
    }
}

// MARK: - Gradient to Color extension

fileprivate extension LinearGradient {
    var toColor: Color? {
        // Return a default color since we can't resolve gradient to a single color
        .orange
    }
}
