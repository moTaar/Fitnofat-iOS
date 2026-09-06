import SwiftUI

// MARK: - Settings View

struct SettingsView: View {
    @StateObject private var authService = AuthService.shared
    @StateObject private var billingStore = BillingStore.shared
    @StateObject private var profileStore = ProfileStore.shared
    @State private var showingSignOut = false
    @State private var showingBilling = false
    @State private var showingDeleteAccount = false

    var body: some View {
        NavigationStack {
            Form {
                // Profile section
                Section("Profile") {
                    NavigationLink(destination: ProfileEditView()) {
                        HStack {
                            Image(systemName: "person.circle.fill")
                                .font(.title2)
                                .foregroundColor(.blue)
                            VStack(alignment: .leading) {
                                Text("Edit Profile")
                                    .font(.headline)
                                Text(profileStore.profile.name.isEmpty ? "Set up your profile" : profileStore.profile.name)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }
                    }
                }

                // Subscription section
                Section("Subscription") {
                    HStack {
                        Image(systemName: billingStore.isEntitled(to: .aiCoach) ? "crown.fill" : "circle")
                            .foregroundColor(billingStore.isEntitled(to: .aiCoach) ? .yellow : .secondary)
                        VStack(alignment: .leading) {
                            Text("ForgeFit Pro")
                                .font(.headline)
                            Text(billingStore.isEntitled(to: .aiCoach) ? "Active" : "Not Subscribed")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        Spacer()
                        if !billingStore.isEntitled(to: .aiCoach) {
                            NavigationLink(destination: BillingView()) {
                                Text("Upgrade")
                                    .font(.subheadline)
                                    .bold()
                            }
                        }
                    }

                    if billingStore.isEntitled(to: .aiCoach) {
                        Button(action: { showingBilling = true }) {
                            Label("Manage Subscription", systemImage: "arrow.right.arrow.left")
                        }
                    }
                }

                // App info
                Section("About") {
                    HStack {
                        Text("Version")
                        Spacer()
                        Text("1.0.0")
                            .foregroundColor(.secondary)
                    }
                    HStack {
                        Text("Build")
                        Spacer()
                        Text("1")
                            .foregroundColor(.secondary)
                    }
                }

                // Account actions
                Section {
                    Button(role: .destructive, action: { showingSignOut = true }) {
                        Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                    Button(role: .destructive, action: { showingDeleteAccount = true }) {
                        Label("Delete Account", systemImage: "trash")
                    }
                }
            }
            .navigationTitle("Settings")
            .alert("Sign Out?", isPresented: $showingSignOut) {
                Button("Sign Out", role: .destructive) { signOut() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Are you sure you want to sign out?")
            }
            .alert("Delete Account?", isPresented: $showingDeleteAccount) {
                Button("Delete", role: .destructive) { deleteAccount() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This action is permanent and cannot be undone.")
            }
            .sheet(isPresented: $showingBilling) {
                BillingView()
            }
        }
    }

    private func signOut() {
        Task { try? await authService.logout() }
    }

    private func deleteAccount() {
        Task {
            do {
                try await APIClient.shared.deleteAccount()
                try await authService.logout()
            } catch {
                print("[Settings] Delete account failed: \(error)")
            }
        }
    }
}

// MARK: - Profile Edit View

struct ProfileEditView: View {
    @StateObject private var profileStore = ProfileStore.shared
    @Environment(\.dismiss) private var dismiss
    @State private var name: String = ""
    @State private var isLoading = false
    @State private var error: String?

    var body: some View {
        Form {
            Section("Personal Info") {
                TextField("Name", text: $name)
            }
        }
        .navigationTitle("Edit Profile")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if isLoading {
                    ProgressView()
                } else {
                    Button("Save") { save() }
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .onAppear {
            name = profileStore.profile.name
        }
    }

    private func save() {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }

        isLoading = true
        Task {
            do {
                try await profileStore.update(UserProfilePatch(name: trimmed))
                dismiss()
            } catch {
                self.error = error.localizedDescription
            }
            isLoading = false
        }
    }
}
