import SwiftUI

// MARK: - Nutrition View

struct NutritionView: View {
    @StateObject private var nutritionStore = NutritionStore.shared
    @StateObject private var billingStore = BillingStore.shared
    @State private var showingGenerate = false
    @State private var showingFoodLookup = false
    @State private var selectedDay: DayType = .training
    @State private var isLoading = false
    @State private var error: String?

    enum DayType: String, CaseIterable {
        case training = "Training Day"
        case rest = "Rest Day"
    }

    var body: some View {
        NavigationStack {
            Group {
                if billingStore.isEntitled(to: .aiNutrition) {
                    if let plan = nutritionStore.nutritionPlan {
                        planContent(plan: plan)
                    } else {
                        emptyState
                    }
                } else {
                    ProUpgradeView(feature: .aiNutrition)
                }
            }
            .navigationTitle("Nutrition")
            .toolbar { toolbarContent }
            .sheet(isPresented: $showingFoodLookup) {
                FoodLookupView()
            }
        }
    }

    // MARK: - Plan Content

    private func planContent(plan: NutritionPlan) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Plan header
                VStack(alignment: .leading, spacing: 4) {
                    Text(plan.strategy)
                        .font(.title2)
                        .bold()
                    Text(plan.summary)
                        .font(.body)
                        .foregroundColor(.secondary)
                    Text("Iteration \(plan.iteration)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding(.horizontal)

                // Day picker
                Picker("Day", selection: $selectedDay) {
                    ForEach(DayType.allCases, id: \.self) { day in
                        Text(day.rawValue).tag(day)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)

                // Day plan
                switch selectedDay {
                case .training:
                    NutritionDayView(dayPlan: plan.trainingDay)
                        .padding(.horizontal)
                case .rest:
                    NutritionDayView(dayPlan: plan.restDay)
                        .padding(.horizontal)
                }

                // Regenerate button
                Button(action: { showingGenerate = true }) {
                    Label("Regenerate Plan", systemImage: "arrow.clockwise")
                        .font(.subheadline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                }
                .buttonStyle(.bordered)
                .padding(.horizontal)
            }
            .padding(.vertical)
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "fork.knife")
                .font(.system(size: 60))
                .foregroundColor(.secondary)
            Text("No Nutrition Plan")
                .font(.title2)
                .bold()
            Text("Generate a personalized nutrition plan based on your goals, diet preferences, and training schedule.")
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            Button(action: { showingGenerate = true }) {
                Label("Generate Plan", systemImage: "sparkles")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
            }
            .buttonStyle(.borderedProminent)
            .padding(.horizontal)
        }
        .padding()
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        if billingStore.isEntitled(to: .aiNutrition) {
            ToolbarItem(placement: .primaryAction) {
                Button(action: { showingFoodLookup = true }) {
                    Image(systemName: "magnifyingglass")
                }
            }
        }
    }
}

// MARK: - Food Lookup View

struct FoodLookupView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var result: FoodLookupResult?
    @State private var isLoading = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                // Search bar
                HStack {
                    TextField("Search food...", text: $query)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit(search)

                    Button(action: search) {
                        if isLoading {
                            ProgressView()
                        } else {
                            Image(systemName: "magnifyingglass")
                        }
                    }
                    .disabled(query.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .padding()

                if let result = result {
                    // Result display
                    VStack(alignment: .leading, spacing: 12) {
                        Text(result.foodName)
                            .font(.title2)
                            .bold()

                        Text("Portion: \(result.portion)")
                            .font(.subheadline)
                            .foregroundColor(.secondary)

                        MacroCardView(targets: result.macros)

                        if let micros = result.micros, !micros.isEmpty {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Micronutrients")
                                    .font(.headline)
                                ForEach(micros, id: \.name) { micro in
                                    HStack {
                                        Text(micro.name)
                                            .font(.subheadline)
                                        Spacer()
                                        Text(micro.amount)
                                            .font(.subheadline)
                                            .foregroundColor(.secondary)
                                    }
                                }
                            }
                        }

                        if let notes = result.notes {
                            Text(notes)
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .italic()
                        }

                        if let confidence = result.confidence {
                            Text("Confidence: \(confidence)")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                    .padding()
                } else if let error = error {
                    ContentUnavailableView(
                        "Not Found",
                        systemImage: "exclamationmark.magnifyingglass",
                        description: Text(error)
                    )
                } else {
                    ContentUnavailableView(
                        "Search Foods",
                        systemImage: "fork.knife",
                        description: Text("Look up nutritional information for any food.")
                    )
                }

                Spacer()
            }
            .navigationTitle("Food Lookup")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func search() {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }

        isLoading = true
        error = nil
        result = nil

        Task {
            do {
                result = try await NutritionStore.shared.lookupFood(query: trimmed)
                if result == nil {
                    error = "No results found"
                }
            } catch {
                self.error = error.localizedDescription
            }
            isLoading = false
        }
    }
}
