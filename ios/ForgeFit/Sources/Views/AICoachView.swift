import SwiftUI

// MARK: - AI Coach View

struct AICoachView: View {
    @StateObject private var coachStore = AICoachStore.shared
    @StateObject private var billingStore = BillingStore.shared
    @State private var messageText = ""
    @State private var selectedImages: [UIImage] = []
    @State private var showingImagePicker = false
    @State private var showCamera = false
    @State private var scrollProxy: ScrollViewProxy?

    var body: some View {
        NavigationStack {
            Group {
                if billingStore.isEntitled(to: .aiCoach) {
                    coachContent
                } else {
                    ProUpgradeView(feature: .aiCoach)
                }
            }
            .navigationTitle("AI Coach")
            .toolbar {
                if !coachStore.messages.isEmpty {
                    ToolbarItem(placement: .primaryAction) {
                        Button(action: coachStore.clear) {
                            Image(systemName: "trash")
                        }
                    }
                }
            }
            .onAppear { coachStore.loadCached() }
        }
    }

    // MARK: - Coach Content

    private var coachContent: some View {
        VStack(spacing: 0) {
            // Messages
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 12) {
                        if coachStore.messages.isEmpty {
                            welcomeMessage
                        }

                        ForEach(coachStore.messages) { message in
                            MessageBubble(message: message)
                        }

                        if coachStore.isLoading {
                            HStack {
                                ProgressView()
                                    .padding()
                                Spacer()
                            }
                        }

                        Color.clear
                            .frame(height: 1)
                            .id("bottom")
                    }
                    .padding()
                }
                .onChange(of: coachStore.messages.count) { _, _ in
                    withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
                }
                .onAppear { scrollProxy = proxy }
            }

            // Image preview
            if !selectedImages.isEmpty {
                imagePreviewBar
            }

            // Input bar
            inputBar
        }
    }

    // MARK: - Welcome Message

    private var welcomeMessage: some View {
        VStack(spacing: 12) {
            Image(systemName: "brain.head.profile")
                .font(.system(size: 50))
                .foregroundColor(.blue)
            Text("AI Coach")
                .font(.title2)
                .bold()
            Text("Ask me anything about your training, form, nutrition, or progress. I can also help update your program based on how you're feeling.")
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            // Suggested questions
            VStack(spacing: 8) {
                ForEach(suggestedQuestions, id: \.self) { question in
                    Button(action: { sendMessage(question) }) {
                        Text(question)
                            .font(.subheadline)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .background(Color(.systemGray5))
                            .cornerRadius(20)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.top, 8)
        }
        .padding()
    }

    private let suggestedQuestions = [
        "How should I progress my squat?",
        "Review my form for bench press",
        "Suggest a deload week",
        "Adjust my program based on fatigue",
    ]

    // MARK: - Image Preview

    private var imagePreviewBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(selectedImages.indices, id: \.self) { index in
                    ZStack(alignment: .topTrailing) {
                        Image(uiImage: selectedImages[index])
                            .resizable()
                            .scaledToFill()
                            .frame(width: 60, height: 60)
                            .clipShape(RoundedRectangle(cornerRadius: 8))

                        Button(action: { selectedImages.remove(at: index) }) {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundColor(.red)
                                .background(Color.white.clipShape(Circle()))
                        }
                        .offset(x: 4, y: -4)
                    }
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 4)
        }
        .background(Color(.systemGray6))
    }

    // MARK: - Input Bar

    private var inputBar: some View {
        VStack(spacing: 0) {
            Divider()
            HStack(spacing: 8) {
                // Image attach button
                Button(action: { showingImagePicker = true }) {
                    Image(systemName: "photo.on.rectangle")
                        .font(.title2)
                        .foregroundColor(.blue)
                }

                // Camera button
                Button(action: { showCamera = true }) {
                    Image(systemName: "camera.fill")
                        .font(.title2)
                        .foregroundColor(.blue)
                }

                // Text field
                TextField("Ask your coach...", text: $messageText)
                    .textFieldStyle(.roundedBorder)

                // Send button
                Button(action: { sendMessage(messageText) }) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title2)
                        .foregroundColor(messageText.trimmingCharacters(in: .whitespaces).isEmpty ? .secondary : .blue)
                }
                .disabled(messageText.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
        .background(Color(.systemBackground))
        .confirmationDialog("Attach Photo", isPresented: $showingImagePicker) {
            Button("Photo Library") { showCamera = false; showingImagePicker = true }
            Button("Camera") { showCamera = true }
            Button("Cancel", role: .cancel) {}
        }
        .sheet(isPresented: $showingImagePicker) {
            ImagePicker(selectedImages: $selectedImages, sourceType: showCamera ? .camera : .photoLibrary)
        }
    }

    // MARK: - Actions

    private func sendMessage(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }

        messageText = ""
        let images = selectedImages
        selectedImages = []

        Task {
            do {
                try await coachStore.send(content: trimmed, images: images.isEmpty ? nil : images)
            } catch {
                print("[AICoach] Send failed: \(error)")
            }
        }
    }
}

// MARK: - Message Bubble

struct MessageBubble: View {
    let message: AICoachStore.CoachMessage

    var body: some View {
        HStack {
            if message.role == "user" {
                Spacer()
            }

            VStack(alignment: message.role == "user" ? .trailing : .leading, spacing: 4) {
                if let images = message.images, !images.isEmpty {
                    ForEach(images.indices, id: \.self) { idx in
                        if let data = Data(base64Encoded: images[idx].data),
                           let uiImage = UIImage(data: data) {
                            Image(uiImage: uiImage)
                                .resizable()
                                .scaledToFit()
                                .frame(maxWidth: 200)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                    }
                }

                Text(message.content)
                    .font(.body)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(message.role == "user" ? Color.blue : Color(.systemGray5))
                    .foregroundColor(message.role == "user" ? .white : .primary)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
            }

            if message.role == "assistant" {
                Spacer()
            }
        }
    }
}

// MARK: - Image Picker

struct ImagePicker: UIViewControllerRepresentable {
    @Binding var selectedImages: [UIImage]
    var sourceType: UIImagePickerController.SourceType = .photoLibrary

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = sourceType
        picker.delegate = context.coordinator
        picker.allowsEditing = false
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: ImagePicker
        init(_ parent: ImagePicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage {
                parent.selectedImages.append(image)
            }
            picker.dismiss(animated: true)
        }
    }
}
