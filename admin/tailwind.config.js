/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#f97316",   // orange-500
        danger:  "#ef4444",   // red-500
        success: "#22c55e",   // green-500
      },
    },
  },
};
