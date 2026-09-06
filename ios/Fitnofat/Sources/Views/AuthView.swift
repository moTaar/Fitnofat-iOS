import SwiftUI

// MARK: - Auth View

struct AuthView: View {
    @StateObject private var authService = AuthService.shared
    @State private var email = ""
    @State private var password = ""
    @State private var isLogin = true
    @State private var isLoading = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // App branding
                    VStack(spacing: 8) {
                        Image(systemName: "dumbbell.fill")
                            .font(.system(size: 60))
                            .foregroundColor(.blue)
                        Text("ForgeFit")
                            .font(.largeTitle)
                            .bold()
                        Text("Your AI-powered fitness companion")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    .padding(.top, 40)

                    // Form
                    VStack(spacing: 16) {
                        TextField("Email", text: $email)
                            .textContentType(.emailAddress)
                            .keyboardType(.emailAddress)
                            .autocapitalization(.none)
                            .disableAutocorrection(true)
                            .textFieldStyle(.roundedBorder)

                        SecureField("Password", text: $password)
                            .textContentType(isLogin ? .password : .newPassword)
                            .textFieldStyle(.roundedBorder)

                        if let error = error {
                            Text(error)
                                .font(.caption)
                                .foregroundColor(.red)
                        }

                        Button(action: submit) {
                            if isLoading {
                                ProgressView()
                                    .tint(.white)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 14)
                            } else {
                                Text(isLogin ? "Sign In" : "Create Account")
                                    .font(.headline)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 14)
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(email.trimmingCharacters(in: .whitespaces).isEmpty || password.isEmpty || isLoading)

                        Button(action: { isLogin.toggle(); error = nil }) {
                            Text(isLogin
                                ? "Don't have an account? Sign Up"
                                : "Already have an account? Sign In")
                                .font(.subheadline)
                        }
                    }
                    .padding(.horizontal)
                }
            }
            .navigationBarHidden(true)
        }
    }

    private func submit() {
        let trimmedEmail = email.trimmingCharacters(in: .whitespaces)
        guard !trimmedEmail.isEmpty, !password.isEmpty else { return }

        isLoading = true
        error = nil

        Task {
            do {
                if isLogin {
                    try await authService.login(email: trimmedEmail, password: password)
                } else {
                    try await authService.signup(email: trimmedEmail, password: password)
                }
            } catch let authError as AuthError {
                error = switch authError {
                case .invalidCredentials: "Invalid email or password."
                case .networkError: "Network error. Please try again."
                case .expired: "Session expired. Please sign in again."
                case .unknown: "An unexpected error occurred."
                }
            } catch {
                self.error = error.localizedDescription
            }
            isLoading = false
        }
    }
}
