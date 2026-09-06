import SwiftUI

// MARK: - Onboarding View

struct OnboardingView: View {
    @StateObject private var profileStore = ProfileStore.shared
    @State private var currentPage = 0
    @State private var name = ""
    @State private var selectedGoal: Goal?
    @State private var selectedExperience: Experience?
    @State private var selectedEquipment: Equipment?
    @State private var selectedActivityLevel: ActivityLevel?
    @State private var isLoading = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack {
                // Progress indicator
                HStack {
                    ForEach(0..<pages.count, id: \.self) { index in
                        Circle()
                            .fill(index <= currentPage ? Color.blue : Color(.systemGray4))
                            .frame(width: 8, height: 8)
                    }
                }
                .padding(.top)

                TabView(selection: $currentPage) {
                    welcomePage.tag(0)
                    goalPage.tag(1)
                    experiencePage.tag(2)
                    equipmentPage.tag(3)
                    activityPage.tag(4)
                    summaryPage.tag(5)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .animation(.easeInOut, value: currentPage)
            }
            .navigationTitle("Setup")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if currentPage < pages.count - 1 {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Skip") { finishOnboarding() }
                    }
                }
            }
        }
    }

    private let pages: [String] = ["Welcome", "Goal", "Experience", "Equipment", "Activity", "Summary"]

    // MARK: - Pages

    private var welcomePage: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "wave.2.hand")
                .font(.system(size: 80))
                .foregroundColor(.blue)
            Text("Welcome to ForgeFit")
                .font(.title)
                .bold()
            Text("Let's set up your profile so we can create a personalized training plan for you.")
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            TextField("Your name", text: $name)
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal)

            Spacer()
            Button(action: { currentPage = 1 }) {
                Text("Get Started")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
            }
            .buttonStyle(.borderedProminent)
            .padding(.horizontal)
            .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            .padding(.bottom)
        }
    }

    private var goalPage: some View {
        VStack(spacing: 16) {
            Spacer()
            Text("What's your primary goal?")
                .font(.title2)
                .bold()

            VStack(spacing: 12) {
                ForEach(Goal.allCases, id: \.self) { goal in
                    Button(action: { selectedGoal = goal; currentPage = 2 }) {
                        HStack {
                            Text(goal.rawValue.replacingOccurrences(of: "_", with: " ").capitalized)
                                .font(.headline)
                                .foregroundColor(.primary)
                            Spacer()
                            if selectedGoal == goal {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundColor(.blue)
                            }
                        }
                        .padding()
                        .background(selectedGoal == goal ? Color.blue.opacity(0.1) : Color(.systemGray6))
                        .cornerRadius(12)
                    }
                }
            }
            .padding(.horizontal)

            Spacer()
        }
    }

    private var experiencePage: some View {
        VStack(spacing: 16) {
            Spacer()
            Text("What's your experience level?")
                .font(.title2)
                .bold()

            VStack(spacing: 12) {
                ForEach(Experience.allCases, id: \.self) { exp in
                    Button(action: { selectedExperience = exp; currentPage = 3 }) {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(exp.rawValue.capitalized)
                                    .font(.headline)
                                    .foregroundColor(.primary)
                                Text(expDescription(exp))
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                            Spacer()
                            if selectedExperience == exp {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundColor(.blue)
                            }
                        }
                        .padding()
                        .background(selectedExperience == exp ? Color.blue.opacity(0.1) : Color(.systemGray6))
                        .cornerRadius(12)
                    }
                }
            }
            .padding(.horizontal)

            Spacer()
        }
    }

    private var equipmentPage: some View {
        VStack(spacing: 16) {
            Spacer()
            Text("What equipment do you have?")
                .font(.title2)
                .bold()

            VStack(spacing: 12) {
                ForEach(Equipment.allCases, id: \.self) { equip in
                    Button(action: { selectedEquipment = equip; currentPage = 4 }) {
                        HStack {
                            Text(equip.rawValue.replacingOccurrences(of: "_", with: " ").capitalized)
                                .font(.headline)
                                .foregroundColor(.primary)
                            Spacer()
                            if selectedEquipment == equip {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundColor(.blue)
                            }
                        }
                        .padding()
                        .background(selectedEquipment == equip ? Color.blue.opacity(0.1) : Color(.systemGray6))
                        .cornerRadius(12)
                    }
                }
            }
            .padding(.horizontal)

            Spacer()
        }
    }

    private var activityPage: some View {
        VStack(spacing: 16) {
            Spacer()
            Text("How often do you work out?")
                .font(.title2)
                .bold()

            VStack(spacing: 12) {
                ForEach(ActivityLevel.allCases, id: \.self) { level in
                    Button(action: { selectedActivityLevel = level; currentPage = 5 }) {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(level.rawValue.replacingOccurrences(of: "_", with: " ").capitalized)
                                    .font(.headline)
                                    .foregroundColor(.primary)
                                Text(activityDescription(level))
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                            Spacer()
                            if selectedActivityLevel == level {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundColor(.blue)
                            }
                        }
                        .padding()
                        .background(selectedActivityLevel == level ? Color.blue.opacity(0.1) : Color(.systemGray6))
                        .cornerRadius(12)
                    }
                }
            }
            .padding(.horizontal)

            Spacer()
        }
    }

    private var summaryPage: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "checkmark.circle")
                .font(.system(size: 60))
                .foregroundColor(.green)
            Text("Ready to Go!")
                .font(.title)
                .bold()
            Text("We'll create a personalized program based on your profile.")
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            VStack(alignment: .leading, spacing: 8) {
                SummaryRow(label: "Name", value: name)
                SummaryRow(label: "Goal", value: selectedGoal?.rawValue.replacingOccurrences(of: "_", with: " ").capitalized ?? "Not set")
                SummaryRow(label: "Experience", value: selectedExperience?.rawValue.capitalized ?? "Not set")
                SummaryRow(label: "Equipment", value: selectedEquipment?.rawValue.replacingOccurrences(of: "_", with: " ").capitalized ?? "Not set")
                SummaryRow(label: "Activity", value: selectedActivityLevel?.rawValue.replacingOccurrences(of: "_", with: " ").capitalized ?? "Not set")
            }
            .padding()
            .background(Color(.systemGray6))
            .cornerRadius(12)
            .padding(.horizontal)

            if let error = error {
                Text(error)
                    .font(.caption)
                    .foregroundColor(.red)
            }

            Spacer()
            Button(action: finishOnboarding) {
                if isLoading {
                    ProgressView()
                        .tint(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                } else {
                    Text("Complete Setup")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                }
            }
            .buttonStyle(.borderedProminent)
            .padding(.horizontal)
            .disabled(isLoading)
            .padding(.bottom)
        }
    }

    // MARK: - Helpers

    private func expDescription(_ exp: Experience) -> String {
        switch exp {
        case .beginner: "New to working out or less than 6 months"
        case .intermediate: "6 months to 2 years of consistent training"
        case .advanced: "2+ years of dedicated training"
        }
    }

    private func activityDescription(_ level: ActivityLevel) -> String {
        switch level {
        case .sedentary: "Less than 2 days per week"
        case .light: "2-3 days per week"
        case .moderate: "3-5 days per week"
        case .veryActive: "5-6 days per week"
        case .extreme: "6-7 days per week with intense sessions"
        }
    }

    private func finishOnboarding() {
        guard let goal = selectedGoal, let exp = selectedExperience,
              let equip = selectedEquipment, let activity = selectedActivityLevel else {
            return
        }

        isLoading = true
        error = nil

        let patch = UserProfilePatch(
            name: name.trimmingCharacters(in: .whitespaces).isEmpty ? nil : name.trimmingCharacters(in: .whitespaces),
            goal: goal,
            experience: exp,
            equipment: equip,
            activityLevel: activity,
            onboarded: true
        )

        Task {
            do {
                try await profileStore.update(patch)
            } catch {
                self.error = error.localizedDescription
            }
            isLoading = false
        }
    }
}

// MARK: - Summary Row

struct SummaryRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .font(.subheadline)
                .foregroundColor(.secondary)
            Spacer()
            Text(value)
                .font(.subheadline)
                .bold()
        }
    }
}
