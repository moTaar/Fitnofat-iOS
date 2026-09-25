import SwiftUI

// MARK: - Pro Upgrade View

struct ProUpgradeView: View {
    let feature: Feature
    @State private var isLoading = false

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "star.fill")
                .font(.system(size: 60))
                .foregroundColor(.yellow)

            Text("Pro Feature")
                .font(.title)
                .bold()

            Text(featureDescription)
                .font(.body)
                .multilineTextAlignment(.center)
                .foregroundColor(.secondary)
                .padding(.horizontal)

            Button(action: upgrade) {
                if isLoading {
                    ProgressView()
                        .tint(.white)
                } else {
                    Label("Upgrade to Pro", systemImage: "crown.fill")
                        .font(.headline)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(LinearGradient(colors: [.yellow, .orange], startPoint: .leading, endPoint: .trailing))
            .foregroundColor(.white)
            .cornerRadius(12)
            .disabled(isLoading)
            .padding(.horizontal)

            Text("Unlock all premium features including AI coaching, nutrition planning, program refreshes, and AI exercise assistance.")
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
        }
        .padding()
    }

    private var featureDescription: String {
        switch feature {
        case .aiCoach: return "Get personalized coaching from our AI coach. Ask questions, get form advice, and optimize your training."
        case .aiNutrition: return "Get personalized meal plans and nutrition guidance tailored to your goals."
        case .programRefresh: return "Refresh your training program with AI-generated updates based on your progress."
        case .aiExercise: return "AI-powered exercise lookup and form guidance for any exercise."
        case .aiMedical: return "An AI nutritionist and medical helper that reviews your health record and keeps your do & don't list."
        }
    }

    private func upgrade() {
        isLoading = true
        Task {
            do {
                let url = try await BillingStore.shared.startCheckout(plan: "pro")
                await UIApplication.shared.open(url)
            } catch {
                print("[ProUpgrade] Failed: \(error)")
            }
            isLoading = false
        }
    }
}
