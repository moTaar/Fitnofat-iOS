import SwiftUI

// MARK: - Macro Card

struct MacroCardView: View {
    let title: String
    let targets: MacroTargets
    let showTitle: Bool

    init(title: String = "", targets: MacroTargets, showTitle: Bool = true) {
        self.title = title
        self.targets = targets
        self.showTitle = showTitle
    }

    var body: some View {
        VStack(spacing: 12) {
            if showTitle && !title.isEmpty {
                Text(title)
                    .font(.headline)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            HStack(spacing: 0) {
                MacroItem(label: "Calories", value: "\(targets.calories)", color: .blue)
                Divider().frame(height: 40)
                MacroItem(label: "Protein", value: "\(targets.protein)g", color: .red)
                Divider().frame(height: 40)
                MacroItem(label: "Carbs", value: "\(targets.carbs)g", color: .green)
                Divider().frame(height: 40)
                MacroItem(label: "Fats", value: "\(targets.fats)g", color: .yellow)
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }
}

// MARK: - Macro Item

struct MacroItem: View {
    let label: String
    let value: String
    let color: Color

    var body: some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.headline)
                .foregroundColor(color)
            Text(label)
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Nutrition Day View

struct NutritionDayView: View {
    let dayPlan: DayPlan

    var body: some View {
        VStack(spacing: 16) {
            // Hydration
            HStack {
                Image(systemName: "drop.fill")
                    .foregroundColor(.blue)
                Text("Water: \(String(format: "%.1f", dayPlan.hydrationLiters))L")
                    .font(.subheadline)
                Spacer()
            }

            // Macros
            MacroCardView(targets: dayPlan.targets)

            // Meals
            ForEach(dayPlan.meals) { meal in
                MealCardView(meal: meal)
            }
        }
    }
}

// MARK: - Meal Card

struct MealCardView: View {
    let meal: Meal

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(meal.name)
                    .font(.headline)
                Spacer()
                Text(meal.timing)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            MacroCardView(targets: meal.macros, showTitle: false)

            ForEach(meal.items) { item in
                HStack {
                    Text(item.food)
                        .font(.subheadline)
                    Spacer()
                    if let cals = item.calories {
                        Text("\(cals) kcal")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    Text(item.amount)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding(.vertical, 2)
            }

            if let note = meal.note {
                Text(note)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .italic()
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }
}
