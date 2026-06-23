import type { ExerciseGuide } from "./types";
import { slugify } from "./exercises";

// Form guides keyed by exercise slug (slugify(name)). Covers the seed library.
// Custom / unknown exercises fall back to `genericGuide` so the UI always has
// something useful to show.
const GUIDES: Record<string, ExerciseGuide> = {
  // ── Chest ──────────────────────────────────────────────────────────────────
  "barbell-bench-press": {
    primaryMuscles: ["Chest"],
    secondaryMuscles: ["Triceps", "Front Delts"],
    steps: [
      "Lie flat, eyes under the bar, feet planted. Grip slightly wider than shoulder-width.",
      "Unrack and hold the bar over your chest with arms straight.",
      "Lower under control to the mid-chest, elbows tucked ~45°.",
      "Press back up and slightly back toward the rack until arms lock out.",
    ],
    cues: [
      "Keep shoulder blades pinched back and down the whole set.",
      "Maintain a slight natural arch and keep glutes on the bench.",
      "Bar path is a shallow J — down to the sternum, up over the shoulders.",
    ],
    mistakes: [
      "Flaring elbows straight out (90°) — stresses the shoulders.",
      "Bouncing the bar off the chest.",
      "Lifting the hips off the bench to cheat the weight.",
    ],
    breathing: "Inhale lowering, brace, exhale through the press.",
  },
  "incline-dumbbell-press": {
    primaryMuscles: ["Upper Chest"],
    secondaryMuscles: ["Front Delts", "Triceps"],
    steps: [
      "Set the bench to 30–45°. Sit back with a dumbbell on each thigh, kick them up to the start.",
      "Start with the dumbbells at upper-chest level, elbows tucked ~45°.",
      "Press up and slightly together until arms are nearly straight.",
      "Lower under control until you feel a stretch across the chest.",
    ],
    cues: [
      "Keep wrists stacked over elbows.",
      "Don't let the dumbbells drift over your face.",
      "Squeeze the chest at the top without clanging the bells.",
    ],
    mistakes: [
      "Setting the incline too steep (turns it into a shoulder press).",
      "Bouncing out of the bottom.",
    ],
    breathing: "Inhale down, exhale up.",
  },
  "dumbbell-bench-press": {
    primaryMuscles: ["Chest"],
    secondaryMuscles: ["Triceps", "Front Delts"],
    steps: [
      "Lie flat, dumbbells at chest height, elbows tucked ~45°.",
      "Press up until arms are straight and the bells are over your chest.",
      "Lower under control to a deep but comfortable stretch.",
    ],
    cues: ["Keep shoulder blades retracted.", "Control the bells — they want to wobble."],
    mistakes: ["Over-stretching at the bottom.", "Letting the dumbbells drift apart."],
    breathing: "Inhale down, exhale up.",
  },
  "push-up": {
    primaryMuscles: ["Chest"],
    secondaryMuscles: ["Triceps", "Front Delts", "Core"],
    steps: [
      "Hands slightly wider than shoulders, body in a straight line head to heels.",
      "Lower until your chest is just above the floor, elbows ~45°.",
      "Press back up to full lockout.",
    ],
    cues: ["Brace your core and squeeze glutes — no sagging hips.", "Keep your neck neutral."],
    mistakes: ["Flaring elbows wide.", "Dropping hips or piking the butt up.", "Half-reps."],
    breathing: "Inhale down, exhale up.",
  },
  "cable-chest-fly": {
    primaryMuscles: ["Chest"],
    secondaryMuscles: ["Front Delts"],
    steps: [
      "Set pulleys at chest height, take a handle in each hand, stagger your stance.",
      "With a soft bend in the elbows, bring your hands together in front of your chest in an arc.",
      "Return slowly until you feel a stretch across the chest.",
    ],
    cues: ["Keep the elbow angle fixed — it's a hug, not a press.", "Lead with the elbows."],
    mistakes: ["Bending/straightening the elbows (turns it into a press).", "Using momentum."],
    breathing: "Exhale as you bring the hands together.",
  },
  dip: {
    primaryMuscles: ["Chest", "Triceps"],
    secondaryMuscles: ["Front Delts"],
    steps: [
      "Support yourself on parallel bars, arms straight.",
      "Lean slightly forward (chest emphasis) and lower until shoulders are near elbow height.",
      "Press back up to lockout.",
    ],
    cues: ["Lean forward for chest, stay upright for triceps.", "Keep shoulders down, away from ears."],
    mistakes: ["Going too deep and overstretching the shoulder.", "Swinging or kipping."],
    breathing: "Inhale down, exhale up.",
  },

  // ── Back ───────────────────────────────────────────────────────────────────
  "pull-up": {
    primaryMuscles: ["Lats", "Back"],
    secondaryMuscles: ["Biceps", "Rear Delts"],
    steps: [
      "Hang from the bar with an overhand grip, slightly wider than shoulders.",
      "Pull your elbows down and back until your chin clears the bar.",
      "Lower under control to a full hang.",
    ],
    cues: ["Drive the elbows toward your hips.", "Squeeze the shoulder blades down at the top."],
    mistakes: ["Kipping/swinging for momentum.", "Not reaching a full hang each rep."],
    breathing: "Exhale pulling up, inhale lowering.",
  },
  "chin-up": {
    primaryMuscles: ["Lats", "Biceps"],
    secondaryMuscles: ["Back"],
    steps: [
      "Hang with a shoulder-width underhand (palms-toward-you) grip.",
      "Pull until your chin clears the bar, driving elbows down.",
      "Lower under control to a full hang.",
    ],
    cues: ["Keep the core braced — no swinging.", "Think about pulling the bar to your collarbone."],
    mistakes: ["Using leg kip.", "Partial range at the bottom."],
    breathing: "Exhale up, inhale down.",
  },
  "barbell-row": {
    primaryMuscles: ["Back", "Lats"],
    secondaryMuscles: ["Biceps", "Rear Delts"],
    steps: [
      "Hinge at the hips to ~45°, back flat, bar hanging at arm's length.",
      "Row the bar to your lower ribs/upper stomach, driving elbows back.",
      "Lower under control without losing the hinge.",
    ],
    cues: ["Keep your spine neutral and braced.", "Pull with the back, not just the arms."],
    mistakes: ["Rounding the lower back.", "Standing up / using body english.", "Yanking with the arms."],
    breathing: "Exhale rowing, inhale lowering.",
  },
  "lat-pulldown": {
    primaryMuscles: ["Lats"],
    secondaryMuscles: ["Biceps", "Back"],
    steps: [
      "Grip the bar wider than shoulders, thighs secured under the pad.",
      "Lean back slightly and pull the bar to your upper chest, driving elbows down.",
      "Return under control to a full stretch.",
    ],
    cues: ["Lead with the elbows, not the hands.", "Keep the chest up throughout."],
    mistakes: ["Leaning way back and turning it into a row.", "Pulling behind the neck.", "Jerking the weight."],
    breathing: "Exhale pulling down, inhale up.",
  },
  "seated-cable-row": {
    primaryMuscles: ["Back"],
    secondaryMuscles: ["Lats", "Biceps", "Rear Delts"],
    steps: [
      "Sit with knees softly bent, grab the handle, torso upright.",
      "Pull the handle to your stomach, driving the elbows back and squeezing the shoulder blades.",
      "Return under control to a full stretch without rounding.",
    ],
    cues: ["Keep the torso still — let the back do the work.", "Squeeze the blades together at the end."],
    mistakes: ["Rocking back and forth for momentum.", "Rounding the back at the stretch."],
    breathing: "Exhale pulling, inhale returning.",
  },
  "single-arm-dumbbell-row": {
    primaryMuscles: ["Back", "Lats"],
    secondaryMuscles: ["Biceps", "Rear Delts"],
    steps: [
      "Place one knee and hand on a bench, opposite foot on the floor, back flat.",
      "Let the dumbbell hang, then row it to your hip, driving the elbow up and back.",
      "Lower under control to a full stretch.",
    ],
    cues: ["Keep your back flat and square — don't rotate the torso.", "Drive the elbow past your side."],
    mistakes: ["Twisting the body to lift heavier.", "Shrugging instead of rowing."],
    breathing: "Exhale rowing, inhale lowering.",
  },
  deadlift: {
    primaryMuscles: ["Back", "Glutes", "Hamstrings"],
    secondaryMuscles: ["Quads", "Core", "Traps"],
    steps: [
      "Stand with mid-foot under the bar, shins close. Hinge and grip just outside the knees.",
      "Drop hips, lift the chest, flatten the back, and take the slack out of the bar.",
      "Drive through the floor, keeping the bar against your legs, until you stand tall.",
      "Reverse by pushing the hips back, then bending the knees once the bar passes them.",
    ],
    cues: ["Brace your core hard before pulling.", "Keep the bar dragging up your legs.", "Squeeze glutes at lockout — don't lean back."],
    mistakes: ["Rounding the lower back.", "Hips shooting up first (turning it into a stiff-leg).", "Bar drifting away from the body."],
    breathing: "Big breath and brace at the bottom, exhale at the top.",
  },

  // ── Shoulders ────────────────────────────────────────────────────────────
  "overhead-press": {
    primaryMuscles: ["Shoulders"],
    secondaryMuscles: ["Triceps", "Upper Chest", "Core"],
    steps: [
      "Bar racked across your front delts, grip just outside shoulders, elbows slightly forward.",
      "Brace the core and glutes, press the bar straight overhead.",
      "As the bar passes your forehead, push your head 'through' so the bar finishes over your mid-foot.",
      "Lower under control back to the front delts.",
    ],
    cues: ["Squeeze glutes to stop leaning back.", "Keep the bar over your base — not out front."],
    mistakes: ["Excessive lower-back arch.", "Pressing the bar forward instead of up.", "Using leg drive (unless push-pressing)."],
    breathing: "Inhale and brace, exhale at lockout.",
  },
  "dumbbell-shoulder-press": {
    primaryMuscles: ["Shoulders"],
    secondaryMuscles: ["Triceps"],
    steps: [
      "Sit or stand with dumbbells at shoulder height, palms forward.",
      "Press overhead until arms are nearly straight.",
      "Lower under control to ear/shoulder height.",
    ],
    cues: ["Keep the core braced and ribs down.", "Don't clang the bells together at the top."],
    mistakes: ["Arching the lower back.", "Half reps at the bottom."],
    breathing: "Exhale pressing, inhale lowering.",
  },
  "lateral-raise": {
    primaryMuscles: ["Side Delts"],
    steps: [
      "Stand with a dumbbell in each hand, slight bend in the elbows.",
      "Raise the arms out to the sides until they're about shoulder height.",
      "Lower slowly under control.",
    ],
    cues: ["Lead with the elbows, pinkies slightly up.", "Use light weight and strict form."],
    mistakes: ["Swinging the weights up with momentum.", "Shrugging the traps.", "Going far above shoulder height."],
    breathing: "Exhale raising, inhale lowering.",
  },
  "face-pull": {
    primaryMuscles: ["Rear Delts"],
    secondaryMuscles: ["Upper Back", "Traps"],
    steps: [
      "Set a rope at upper-chest/face height. Grip both ends, thumbs back.",
      "Pull the rope toward your forehead, splitting your hands apart and out.",
      "Squeeze the rear delts, then return under control.",
    ],
    cues: ["Elbows high, lead with the knuckles.", "Externally rotate — make a double-biceps pose."],
    mistakes: ["Using too much weight and rowing it.", "Pulling too low (to the chest)."],
    breathing: "Exhale pulling, inhale returning.",
  },
  "rear-delt-fly": {
    primaryMuscles: ["Rear Delts"],
    secondaryMuscles: ["Upper Back"],
    steps: [
      "Hinge at the hips with a flat back, dumbbells hanging below your chest.",
      "With a soft elbow bend, raise the arms out to the sides until level with your torso.",
      "Lower under control.",
    ],
    cues: ["Lead with the elbows.", "Keep the chest down and back flat."],
    mistakes: ["Using momentum / standing up.", "Turning it into a row."],
    breathing: "Exhale raising, inhale lowering.",
  },

  // ── Biceps ───────────────────────────────────────────────────────────────
  "barbell-curl": {
    primaryMuscles: ["Biceps"],
    secondaryMuscles: ["Forearms"],
    steps: [
      "Stand tall, shoulder-width underhand grip, bar at thighs.",
      "Curl the bar up by flexing the biceps, elbows pinned to your sides.",
      "Lower under control to full extension.",
    ],
    cues: ["Keep elbows still — only the forearms move.", "Squeeze at the top."],
    mistakes: ["Swinging the torso for momentum.", "Letting the elbows drift forward."],
    breathing: "Exhale curling, inhale lowering.",
  },
  "dumbbell-curl": {
    primaryMuscles: ["Biceps"],
    secondaryMuscles: ["Forearms"],
    steps: [
      "Stand with a dumbbell in each hand, palms forward (or rotating up as you curl).",
      "Curl up while keeping elbows pinned at your sides.",
      "Lower under control to full extension.",
    ],
    cues: ["Supinate (turn the pinky up) for a stronger contraction.", "No swinging."],
    mistakes: ["Using the shoulders/back to heave.", "Partial range of motion."],
    breathing: "Exhale curling, inhale lowering.",
  },
  "hammer-curl": {
    primaryMuscles: ["Biceps", "Brachialis"],
    secondaryMuscles: ["Forearms"],
    steps: [
      "Hold dumbbells with a neutral grip (palms facing each other).",
      "Curl up keeping the neutral grip, elbows at your sides.",
      "Lower under control.",
    ],
    cues: ["Keep wrists neutral and elbows fixed.", "Controlled tempo."],
    mistakes: ["Swinging.", "Rotating the wrists."],
    breathing: "Exhale curling, inhale lowering.",
  },
  "cable-curl": {
    primaryMuscles: ["Biceps"],
    secondaryMuscles: ["Forearms"],
    steps: [
      "Attach a bar to a low pulley, grip underhand, step back for tension.",
      "Curl the bar up keeping elbows pinned at your sides.",
      "Lower under control — constant cable tension throughout.",
    ],
    cues: ["Keep tension the whole rep.", "Don't let the elbows drift."],
    mistakes: ["Leaning back to cheat.", "Letting the stack slam."],
    breathing: "Exhale curling, inhale lowering.",
  },

  // ── Triceps ──────────────────────────────────────────────────────────────
  "tricep-pushdown": {
    primaryMuscles: ["Triceps"],
    steps: [
      "Face a high pulley with a bar/rope, elbows pinned at your sides.",
      "Push down until the arms are fully straight, squeezing the triceps.",
      "Return under control to ~90° at the elbow.",
    ],
    cues: ["Keep the elbows glued to your sides.", "Only the forearms move."],
    mistakes: ["Leaning over and using bodyweight.", "Letting the elbows flare out and forward."],
    breathing: "Exhale pushing down, inhale up.",
  },
  "overhead-tricep-extension": {
    primaryMuscles: ["Triceps"],
    steps: [
      "Hold a dumbbell overhead with both hands, elbows pointing up.",
      "Lower the weight behind your head by bending the elbows.",
      "Extend back to straight arms, squeezing the triceps.",
    ],
    cues: ["Keep the elbows pointing forward, close to your head.", "Get a full stretch at the bottom."],
    mistakes: ["Flaring the elbows wide.", "Arching the lower back."],
    breathing: "Inhale lowering, exhale extending.",
  },
  "close-grip-bench-press": {
    primaryMuscles: ["Triceps"],
    secondaryMuscles: ["Chest", "Front Delts"],
    steps: [
      "Lie on a flat bench, grip about shoulder-width.",
      "Lower the bar to your lower chest, keeping elbows tucked close.",
      "Press back up to lockout, driving with the triceps.",
    ],
    cues: ["Keep elbows tucked to your sides.", "Don't grip narrower than shoulder-width (wrist strain)."],
    mistakes: ["Flaring the elbows.", "Gripping too narrow."],
    breathing: "Inhale down, exhale up.",
  },
  "skull-crusher": {
    primaryMuscles: ["Triceps"],
    steps: [
      "Lie flat holding an EZ-bar over your chest, arms straight.",
      "Bend at the elbows to lower the bar toward your forehead/behind your head.",
      "Extend back to straight arms.",
    ],
    cues: ["Keep the upper arms still — hinge only at the elbow.", "Control the eccentric."],
    mistakes: ["Letting the elbows flare and drift.", "Turning it into a press."],
    breathing: "Inhale lowering, exhale extending.",
  },

  // ── Legs ─────────────────────────────────────────────────────────────────
  "barbell-back-squat": {
    primaryMuscles: ["Quads", "Glutes"],
    secondaryMuscles: ["Hamstrings", "Core"],
    steps: [
      "Bar on your upper traps, grip firm, feet shoulder-width, toes slightly out.",
      "Brace your core, break at the hips and knees together.",
      "Descend until your thighs are at least parallel, knees tracking over toes.",
      "Drive through your whole foot back to standing.",
    ],
    cues: ["Keep the chest up and the back braced.", "Push the knees out, weight on mid-foot."],
    mistakes: ["Knees caving inward.", "Heels lifting / weight on toes.", "Rounding the lower back ('butt wink' with too much depth)."],
    breathing: "Big breath at the top, brace down, exhale standing up.",
  },
  "front-squat": {
    primaryMuscles: ["Quads"],
    secondaryMuscles: ["Glutes", "Core", "Upper Back"],
    steps: [
      "Rack the bar across your front delts, elbows high, fingertips under the bar.",
      "Brace and squat down keeping the torso upright.",
      "Descend to at least parallel, then drive up.",
    ],
    cues: ["Keep the elbows high the entire rep.", "Stay tall — the bar should stay over mid-foot."],
    mistakes: ["Elbows dropping (bar rolls forward).", "Letting the chest collapse."],
    breathing: "Brace at the top, exhale standing up.",
  },
  "leg-press": {
    primaryMuscles: ["Quads", "Glutes"],
    secondaryMuscles: ["Hamstrings"],
    steps: [
      "Sit with feet shoulder-width on the platform, back and hips against the pad.",
      "Release the safeties, lower the platform until knees reach ~90°.",
      "Press back up without locking the knees hard.",
    ],
    cues: ["Keep your lower back flat against the pad.", "Don't let the knees cave in."],
    mistakes: ["Letting the lower back round at the bottom.", "Bouncing or locking out aggressively."],
    breathing: "Inhale lowering, exhale pressing.",
  },
  "romanian-deadlift": {
    primaryMuscles: ["Hamstrings", "Glutes"],
    secondaryMuscles: ["Back"],
    steps: [
      "Stand tall holding the bar at your thighs, soft knees.",
      "Push your hips back, lowering the bar down your legs with a flat back.",
      "Stop when you feel a strong hamstring stretch (about shin level).",
      "Drive the hips forward to stand tall.",
    ],
    cues: ["It's a hip hinge — knees stay mostly fixed.", "Keep the bar close to your legs the whole way."],
    mistakes: ["Rounding the back.", "Turning it into a squat (bending the knees too much).", "Bar drifting forward."],
    breathing: "Inhale on the way down, exhale standing up.",
  },
  "walking-lunge": {
    primaryMuscles: ["Quads", "Glutes"],
    secondaryMuscles: ["Hamstrings", "Core"],
    steps: [
      "Hold dumbbells at your sides, stand tall.",
      "Step forward and lower until both knees are ~90°, back knee near the floor.",
      "Drive through the front heel to step into the next lunge.",
    ],
    cues: ["Keep the torso upright.", "Front knee tracks over the foot, not past the toes excessively."],
    mistakes: ["Front knee caving in.", "Leaning too far forward.", "Short, choppy steps."],
    breathing: "Inhale lowering, exhale driving up.",
  },
  "leg-extension": {
    primaryMuscles: ["Quads"],
    steps: [
      "Sit with the pad on your lower shins, knees aligned with the machine pivot.",
      "Extend your legs until straight, squeezing the quads.",
      "Lower under control.",
    ],
    cues: ["Pause and squeeze at the top.", "Control the negative — don't let it slam."],
    mistakes: ["Using momentum / kicking.", "Letting the weight drop fast."],
    breathing: "Exhale extending, inhale lowering.",
  },
  "leg-curl": {
    primaryMuscles: ["Hamstrings"],
    steps: [
      "Position the pad just above your heels (seated or lying).",
      "Curl your heels toward your glutes, squeezing the hamstrings.",
      "Return under control to a stretch.",
    ],
    cues: ["Keep the hips down on the pad.", "Squeeze at the end of the curl."],
    mistakes: ["Lifting the hips to cheat.", "Bouncing out of the stretch."],
    breathing: "Exhale curling, inhale returning.",
  },
  "bulgarian-split-squat": {
    primaryMuscles: ["Quads", "Glutes"],
    secondaryMuscles: ["Hamstrings", "Core"],
    steps: [
      "Place the top of your rear foot on a bench, front foot a stride ahead.",
      "Lower straight down until the front thigh is about parallel.",
      "Drive through the front heel to stand.",
    ],
    cues: ["Keep most of the weight on the front leg.", "Stay tall; lean slightly forward for more glute."],
    mistakes: ["Front knee caving in.", "Stance too short (knee shoots forward)."],
    breathing: "Inhale lowering, exhale driving up.",
  },
  "calf-raise": {
    primaryMuscles: ["Calves"],
    steps: [
      "Balls of the feet on a step/platform, heels free to drop.",
      "Lower the heels for a full stretch.",
      "Rise up onto the toes as high as possible and squeeze.",
    ],
    cues: ["Full range — deep stretch, high contraction.", "Pause at the top."],
    mistakes: ["Bouncing with a short range.", "Rushing the reps."],
    breathing: "Exhale raising, inhale lowering.",
  },
  "goblet-squat": {
    primaryMuscles: ["Quads", "Glutes"],
    secondaryMuscles: ["Core"],
    steps: [
      "Hold a dumbbell/kettlebell vertically against your chest.",
      "Squat down between your knees, keeping the chest up.",
      "Descend to at least parallel, then drive up.",
    ],
    cues: ["Elbows track inside the knees at the bottom.", "Keep the weight close to your chest."],
    mistakes: ["Rounding the upper back.", "Heels lifting."],
    breathing: "Inhale down, exhale up.",
  },

  // ── Glutes ───────────────────────────────────────────────────────────────
  "hip-thrust": {
    primaryMuscles: ["Glutes"],
    secondaryMuscles: ["Hamstrings"],
    steps: [
      "Upper back against a bench, bar across your hips (use a pad), feet flat.",
      "Drive through your heels to lift the hips until the torso is parallel to the floor.",
      "Squeeze the glutes hard at the top, then lower under control.",
    ],
    cues: ["Tuck the chin and keep ribs down.", "Finish with a hard glute squeeze, shins vertical."],
    mistakes: ["Overextending the lower back at the top.", "Pushing through the toes instead of heels."],
    breathing: "Exhale driving up, inhale lowering.",
  },
  "glute-bridge": {
    primaryMuscles: ["Glutes"],
    secondaryMuscles: ["Hamstrings"],
    steps: [
      "Lie on your back, knees bent, feet flat and close to your glutes.",
      "Drive through the heels and lift the hips until your body forms a straight line.",
      "Squeeze the glutes, then lower under control.",
    ],
    cues: ["Posterior pelvic tilt — squeeze, don't arch.", "Keep the core braced."],
    mistakes: ["Arching the lower back.", "Pushing through the toes."],
    breathing: "Exhale lifting, inhale lowering.",
  },
  "cable-kickback": {
    primaryMuscles: ["Glutes"],
    steps: [
      "Attach an ankle strap to a low pulley, hinge slightly forward and brace.",
      "Drive the working leg straight back, squeezing the glute.",
      "Return under control without swinging.",
    ],
    cues: ["Keep the hips square and the core tight.", "Squeeze at full extension."],
    mistakes: ["Arching the back to swing the leg higher.", "Using momentum."],
    breathing: "Exhale kicking back, inhale returning.",
  },

  // ── Core ─────────────────────────────────────────────────────────────────
  plank: {
    primaryMuscles: ["Core"],
    secondaryMuscles: ["Shoulders", "Glutes"],
    steps: [
      "Forearms on the floor under your shoulders, legs extended on your toes.",
      "Form a straight line from head to heels and hold.",
    ],
    cues: ["Brace the abs and squeeze the glutes.", "Keep the hips level — no sagging or piking."],
    mistakes: ["Letting the hips drop.", "Raising the butt too high.", "Holding your breath."],
    breathing: "Breathe steadily throughout the hold.",
  },
  "hanging-leg-raise": {
    primaryMuscles: ["Core", "Lower Abs"],
    secondaryMuscles: ["Hip Flexors"],
    steps: [
      "Hang from a bar with a firm grip, body still.",
      "Raise your legs (straight or knees bent) until your thighs are at least parallel.",
      "Lower under control without swinging.",
    ],
    cues: ["Curl the pelvis up — don't just lift the legs.", "Control the swing."],
    mistakes: ["Using momentum to kip.", "Only using the hip flexors (no pelvic curl)."],
    breathing: "Exhale raising, inhale lowering.",
  },
  "cable-crunch": {
    primaryMuscles: ["Core", "Abs"],
    steps: [
      "Kneel facing a high pulley with a rope, hands by your head.",
      "Crunch down by flexing the spine, bringing your elbows toward your thighs.",
      "Return under control, feeling the abs stretch.",
    ],
    cues: ["Round the spine — it's a crunch, not a hip hinge.", "Keep the hips fixed."],
    mistakes: ["Bending at the hips instead of the spine.", "Using the arms to pull."],
    breathing: "Exhale crunching down, inhale returning.",
  },
  "russian-twist": {
    primaryMuscles: ["Obliques", "Core"],
    steps: [
      "Sit with knees bent, lean back to ~45°, feet up or down.",
      "Rotate your torso to tap a weight to each side.",
      "Keep the movement controlled and continuous.",
    ],
    cues: ["Rotate from the torso, not just the arms.", "Keep the chest up."],
    mistakes: ["Just swinging the arms.", "Rounding the back excessively."],
    breathing: "Exhale on each rotation.",
  },
  "ab-wheel-rollout": {
    primaryMuscles: ["Core", "Abs"],
    secondaryMuscles: ["Lats", "Shoulders"],
    steps: [
      "Kneel holding the wheel under your shoulders, brace hard.",
      "Roll forward as far as you can control while keeping a flat back.",
      "Pull yourself back using your abs.",
    ],
    cues: ["Tuck the pelvis and brace — never let the lower back arch.", "Only go as far as you can control."],
    mistakes: ["Letting the hips sag and the back arch.", "Rolling out too far too soon."],
    breathing: "Inhale rolling out, exhale pulling back.",
  },

  // ── Calisthenics ─────────────────────────────────────────────────────────
  "pike-push-up": {
    primaryMuscles: ["Shoulders"],
    secondaryMuscles: ["Triceps", "Upper Chest", "Core"],
    steps: [
      "Form an inverted V with your hips high, hands shoulder-width, feet on the floor.",
      "Bend the elbows and lower the top of your head toward the floor between your hands.",
      "Press back up to the inverted V position.",
    ],
    cues: ["The higher the hips, the more shoulder-dominant it becomes.", "Keep the core tight throughout."],
    mistakes: ["Letting the hips drop (becomes a push-up).", "Flaring the elbows wide."],
    breathing: "Inhale lowering, exhale pressing.",
  },
  "diamond-push-up": {
    primaryMuscles: ["Triceps"],
    secondaryMuscles: ["Chest", "Front Delts"],
    steps: [
      "Place hands together under your chest, index fingers and thumbs forming a diamond.",
      "Keep the body in a straight line from head to heels.",
      "Lower until your chest nearly touches your hands, elbows tracking back.",
      "Press back to full extension.",
    ],
    cues: ["Elbows should travel back along the sides, not out.", "Brace the core the whole set."],
    mistakes: ["Flaring the elbows wide.", "Dropping the hips."],
    breathing: "Inhale down, exhale up.",
  },
  "decline-push-up": {
    primaryMuscles: ["Upper Chest"],
    secondaryMuscles: ["Front Delts", "Triceps"],
    steps: [
      "Place feet on an elevated surface (bench, box), hands on the floor shoulder-width.",
      "Lower your chest toward the floor, elbows ~45°.",
      "Press back to full extension.",
    ],
    cues: ["The higher the feet, the more upper-chest focused.", "Maintain a rigid plank body."],
    mistakes: ["Hips piking up.", "Short range of motion."],
    breathing: "Inhale down, exhale up.",
  },
  "incline-push-up": {
    primaryMuscles: ["Chest"],
    secondaryMuscles: ["Triceps", "Shoulders"],
    steps: [
      "Place hands on an elevated surface (bench, wall), body in a straight line.",
      "Lower your chest to the surface, elbows ~45°.",
      "Press back to full extension.",
    ],
    cues: ["Good regression for beginners building toward floor push-ups.", "Keep the body rigid."],
    mistakes: ["Bending at the hips.", "Half reps."],
    breathing: "Inhale down, exhale up.",
  },
  "wide-push-up": {
    primaryMuscles: ["Chest"],
    secondaryMuscles: ["Front Delts", "Triceps"],
    steps: [
      "Hands wider than shoulder-width, body in a straight plank.",
      "Lower your chest toward the floor.",
      "Press back up, squeezing the chest.",
    ],
    cues: ["Wider grip increases the chest stretch at the bottom.", "Control the descent."],
    mistakes: ["Letting the elbows flare too far back.", "Dropping the hips."],
    breathing: "Inhale down, exhale up.",
  },
  "handstand-push-up": {
    primaryMuscles: ["Shoulders"],
    secondaryMuscles: ["Triceps", "Core", "Upper Chest"],
    steps: [
      "Kick up to a handstand against a wall, hands shoulder-width, fingers spread.",
      "Lower the top of your head toward the floor by bending the elbows.",
      "Press back to full lockout.",
    ],
    cues: ["Keep the core and glutes tight to avoid arching.", "Fingers forward and slightly spread for stability."],
    mistakes: ["Flaring the elbows wide.", "Excessive arch in the lower back."],
    breathing: "Inhale lowering, exhale pressing.",
  },
  "muscle-up": {
    primaryMuscles: ["Back", "Chest"],
    secondaryMuscles: ["Biceps", "Triceps", "Core"],
    steps: [
      "Start from a dead hang with a false (thumbless) grip slightly wider than shoulders.",
      "Pull explosively, driving your elbows down and your chest up toward the bar.",
      "Once your hips are at bar level, transition by rotating the wrists and pressing up.",
      "Lockout to a straight-arm support position above the bar.",
    ],
    cues: ["The pull must be explosive — power comes from the hips too.", "The wrist turn-over is a practiced skill; drill it slowly first."],
    mistakes: ["Kipping without the strength base (build strict pull-ups and dips first).", "Stopping the pull too early."],
    breathing: "Exhale explosively on the pull, inhale on the way down.",
  },
  "l-sit": {
    primaryMuscles: ["Core", "Hip Flexors"],
    secondaryMuscles: ["Triceps", "Shoulders"],
    steps: [
      "Support yourself on parallel bars (or the floor with blocks), arms straight.",
      "Compress the abs and lift your legs to horizontal, forming an 'L' shape.",
      "Hold the position for the target time.",
    ],
    cues: ["Push the floor/bars down hard to elevate your hips.", "Point the toes."],
    mistakes: ["Bending the knees (start with a tuck L-sit as a regression).", "Shrugging the shoulders."],
    breathing: "Breathe steadily throughout the hold.",
  },
  "pistol-squat": {
    primaryMuscles: ["Quads", "Glutes"],
    secondaryMuscles: ["Hamstrings", "Core", "Ankle Stability"],
    steps: [
      "Stand on one leg, extend the other leg straight in front.",
      "Sit back and down on the standing leg, keeping the heel flat and knee tracking over the toes.",
      "Descend to full depth, then drive back up to standing.",
    ],
    cues: ["Extend the arms forward for counterbalance.", "Control the descent — don't collapse."],
    mistakes: ["Heel lifting (work ankle mobility).", "Knee caving inward.", "Using momentum at the bottom."],
    breathing: "Inhale down, exhale driving up.",
  },
  "box-jump": {
    primaryMuscles: ["Legs", "Glutes"],
    secondaryMuscles: ["Calves", "Core"],
    steps: [
      "Stand arm's length from the box, feet shoulder-width.",
      "Drop into a quarter-squat, swing the arms back, then explode up onto the box.",
      "Land softly with both feet flat, absorbing with the legs.",
      "Step down (don't jump down) and reset.",
    ],
    cues: ["Land quietly — noisy landing means too much impact.", "Pull the knees up to clear the box."],
    mistakes: ["Landing with stiff legs.", "Jumping down (adds unnecessary landing stress)."],
    breathing: "Exhale on the jump, inhale resetting.",
  },
  "jump-squat": {
    primaryMuscles: ["Legs", "Glutes"],
    secondaryMuscles: ["Calves", "Core"],
    steps: [
      "Stand with feet shoulder-width, drop into a squat.",
      "Explode upward, leaving the ground, arms swinging for momentum.",
      "Land softly with bent knees and immediately sink into the next squat.",
    ],
    cues: ["Land through the toes → mid-foot → heel to absorb impact.", "Keep reps rhythmic and controlled."],
    mistakes: ["Stiff-legged landings.", "Leaning forward excessively on takeoff."],
    breathing: "Exhale on the jump.",
  },
  "mountain-climber": {
    primaryMuscles: ["Core"],
    secondaryMuscles: ["Cardio", "Shoulders", "Hip Flexors"],
    steps: [
      "Start in a high push-up plank, wrists under shoulders.",
      "Drive one knee toward the chest, then quickly switch feet in a running motion.",
      "Keep hips level throughout.",
    ],
    cues: ["The faster you go the more cardio; slower gives more core focus.", "Keep the hips from bouncing up."],
    mistakes: ["Hips piking up.", "Letting the shoulders drift behind the wrists."],
    breathing: "Breathe rhythmically.",
  },
  "inverted-row": {
    primaryMuscles: ["Back", "Lats"],
    secondaryMuscles: ["Biceps", "Rear Delts"],
    steps: [
      "Lie under a bar (set to hip height), grip overhand, body in a straight line.",
      "Pull your chest to the bar, driving elbows back.",
      "Lower under control to arms straight.",
    ],
    cues: ["Keep the body rigid — squeeze glutes.", "Lead with the chest, not the chin."],
    mistakes: ["Hips sagging.", "Partial range of motion."],
    breathing: "Exhale pulling up, inhale lowering.",
  },
  "tuck-planche": {
    primaryMuscles: ["Shoulders", "Core"],
    secondaryMuscles: ["Chest", "Triceps"],
    steps: [
      "Start in a support position on parallel bars or the floor with hands beside hips.",
      "Lean forward, shifting your weight over your hands, and tuck the knees to the chest.",
      "Hold the tucked position with arms straight.",
    ],
    cues: ["Protract (push out) the shoulder blades hard.", "The more you lean forward, the harder it gets."],
    mistakes: ["Bent arms (weakens the position).", "Not leaning forward enough to get off the floor."],
    breathing: "Steady breathing throughout the hold.",
  },

  // ── Yoga / Pilates ───────────────────────────────────────────────────────
  "downward-dog": {
    primaryMuscles: ["Hamstrings", "Calves"],
    secondaryMuscles: ["Shoulders", "Back", "Core"],
    steps: [
      "Start on all fours, tuck the toes, and lift the hips up and back.",
      "Press through the palms and lengthen the spine, forming an inverted V.",
      "Work the heels toward the floor and hold.",
    ],
    cues: ["Externally rotate the upper arms to broaden the shoulders.", "Keep the back flat — bend the knees if needed."],
    mistakes: ["Rounding the spine.", "Putting too much weight on the wrists — push the floor away."],
    breathing: "Deep, steady breaths.",
  },
  "warrior-i": {
    primaryMuscles: ["Hip Flexors", "Quads"],
    secondaryMuscles: ["Glutes", "Shoulders", "Core"],
    steps: [
      "From standing, step one foot back about 4 feet, back foot turned ~45°.",
      "Bend the front knee to ~90°, keeping it over the ankle.",
      "Raise the arms overhead and square the hips to the front.",
    ],
    cues: ["Ground the outer edge of the back foot.", "Keep the front knee tracking over the second toe."],
    mistakes: ["Front knee caving inward.", "Back heel lifting."],
    breathing: "Long, deep breaths.",
  },
  "warrior-ii": {
    primaryMuscles: ["Quads", "Glutes"],
    secondaryMuscles: ["Core", "Inner Thighs"],
    steps: [
      "Step feet wide (~4 feet), front foot forward, back foot perpendicular.",
      "Bend the front knee to ~90°, arms extended in a T at shoulder height.",
      "Gaze over the front fingertips.",
    ],
    cues: ["Stack the front knee over the ankle — not past the toes.", "Keep the torso directly above the hips."],
    mistakes: ["Front knee collapsing inward.", "Leaning the torso forward."],
    breathing: "Slow, even breaths.",
  },
  "cat-cow": {
    primaryMuscles: ["Back"],
    secondaryMuscles: ["Core", "Neck"],
    steps: [
      "On all fours, wrists under shoulders, knees under hips.",
      "Cow: drop the belly, lift the chest and tailbone (inhale).",
      "Cat: round the spine toward the ceiling, tuck the chin and pelvis (exhale).",
      "Flow between the two with breath.",
    ],
    cues: ["Move one vertebra at a time.", "Link breath to movement."],
    mistakes: ["Rushing through without linking breath.", "Moving only the head and tail, not the whole spine."],
    breathing: "Inhale for cow, exhale for cat.",
  },
  "bird-dog": {
    primaryMuscles: ["Core", "Lower Back"],
    secondaryMuscles: ["Glutes", "Shoulders"],
    steps: [
      "Start on all fours, spine neutral.",
      "Extend the opposite arm and leg simultaneously until both are parallel to the floor.",
      "Hold briefly, return, and repeat on the other side.",
    ],
    cues: ["Keep the hips level — don't let them rotate.", "Think 'long' — reach rather than lift."],
    mistakes: ["Hips rotating or hiking.", "Arching the lower back at the top."],
    breathing: "Exhale extending, inhale returning.",
  },
  "dead-bug": {
    primaryMuscles: ["Core", "Abs"],
    secondaryMuscles: ["Hip Flexors"],
    steps: [
      "Lie on your back, arms up to the ceiling, hips and knees at 90°.",
      "Slowly lower the opposite arm and leg toward the floor while keeping the lower back pressed down.",
      "Return and repeat on the other side.",
    ],
    cues: ["Press your lower back into the floor throughout.", "Breathe out as you lower the limbs."],
    mistakes: ["Lower back arching off the floor.", "Moving too fast."],
    breathing: "Exhale as you extend the limbs.",
  },
  "child-s-pose": {
    primaryMuscles: ["Back"],
    secondaryMuscles: ["Hips", "Ankles"],
    steps: [
      "Kneel and sit back toward your heels.",
      "Fold forward, extending the arms overhead on the floor.",
      "Rest and breathe into the stretch.",
    ],
    cues: ["Widen the knees for a deeper hip stretch.", "Let gravity do the work."],
    mistakes: ["Holding tension in the shoulders — let them drop."],
    breathing: "Deep belly breaths.",
  },
  "pigeon-pose": {
    primaryMuscles: ["Hip Flexors", "Glutes"],
    secondaryMuscles: ["Quads", "IT Band"],
    steps: [
      "From a push-up position, bring the right knee forward between your hands, shin angled on the floor.",
      "Extend the left leg straight back, hips squaring to the floor.",
      "Walk the hands forward and lower your torso over the front leg.",
    ],
    cues: ["Keep the hips as even as possible.", "Use a block under the hip if needed."],
    mistakes: ["Letting the hips roll to one side.", "Forcing depth."],
    breathing: "Deep, slow breaths into the hips.",
  },
  "hip-flexor-stretch": {
    primaryMuscles: ["Hip Flexors"],
    secondaryMuscles: ["Quads"],
    steps: [
      "Kneel on one knee, other foot forward, front knee at 90°.",
      "Shift the hips forward until you feel a stretch in the front of the rear hip.",
      "Hold, then switch sides.",
    ],
    cues: ["Keep the torso tall — don't lean forward.", "Squeeze the glute of the rear leg to deepen the stretch."],
    mistakes: ["Letting the front knee collapse inward.", "Tilting the pelvis forward (anterior tilt)."],
    breathing: "Slow, deep breaths.",
  },
  "supine-spinal-twist": {
    primaryMuscles: ["Back"],
    secondaryMuscles: ["Obliques", "Glutes", "IT Band"],
    steps: [
      "Lie on your back, hug one knee to the chest.",
      "Guide the knee across the body to the opposite side while extending the arm out.",
      "Look the opposite direction from the knee.",
    ],
    cues: ["Keep both shoulders on the floor.", "Allow gravity to deepen the twist."],
    mistakes: ["Forcing the shoulder off the floor.", "Rushing the transition."],
    breathing: "Exhale into the twist.",
  },
  "yoga-push-up-chaturanga": {
    primaryMuscles: ["Chest", "Triceps"],
    secondaryMuscles: ["Core", "Front Delts"],
    steps: [
      "Start in a high plank, elbows tucked close to the body.",
      "Lower slowly, keeping the elbows against the ribs, until just above the floor.",
      "Transition to upward dog or cobra by pressing into the hands.",
    ],
    cues: ["Elbows track back — not out.", "Keep the body in one plane."],
    mistakes: ["Flaring the elbows.", "Dropping the hips first."],
    breathing: "Inhale in high plank, exhale lowering.",
  },

  // ── Additional Cardio / HIIT ──────────────────────────────────────────────
  "stationary-bike": {
    primaryMuscles: ["Cardio", "Legs"],
    secondaryMuscles: ["Glutes", "Calves"],
    steps: [
      "Adjust the seat so there is a slight bend in the knee at the bottom of the pedal stroke.",
      "Start at a comfortable cadence, maintain an upright posture.",
      "Increase resistance or speed for intervals as programmed.",
    ],
    cues: ["Push through the whole pedal stroke — pull up as well as push down.", "Keep the core lightly braced."],
    mistakes: ["Seat too low (excessive knee bend).", "Hunching over the handlebars."],
    breathing: "Rhythmic, controlled breathing.",
  },
  "elliptical": {
    primaryMuscles: ["Cardio", "Legs"],
    secondaryMuscles: ["Core", "Glutes"],
    steps: [
      "Step onto the pedals and grip the moving handles.",
      "Push and pull the handles while driving the pedals in a smooth oval motion.",
      "Keep an upright posture and drive through the heels.",
    ],
    cues: ["Resist the temptation to lean on the handles.", "Keep strides smooth — no jerking."],
    mistakes: ["Rocking the hips side to side.", "Letting the machine carry you — provide resistance."],
    breathing: "Steady, rhythmic breathing.",
  },
  "stair-climber": {
    primaryMuscles: ["Glutes", "Legs"],
    secondaryMuscles: ["Cardio", "Calves", "Core"],
    steps: [
      "Stand tall on the machine, light fingertip touch on the rails for balance.",
      "Take full steps, pressing through the whole foot.",
      "Maintain an upright posture throughout.",
    ],
    cues: ["Don't lean heavily on the handrails — that reduces the work.", "Full steps activate more glute."],
    mistakes: ["Resting all your weight on the rails.", "Tiny half-steps reducing the range of motion."],
    breathing: "Controlled, rhythmic breathing.",
  },
  "high-knees": {
    primaryMuscles: ["Cardio", "Hip Flexors"],
    secondaryMuscles: ["Quads", "Core", "Calves"],
    steps: [
      "Stand tall and run in place, driving the knees up to at least hip height.",
      "Pump the opposite arms in sync.",
      "Land on the balls of the feet.",
    ],
    cues: ["Stay on your toes for a faster tempo.", "Keep the core braced to control the torso."],
    mistakes: ["Leaning back excessively.", "Low, lazy knee drive."],
    breathing: "Rhythmic breathing.",
  },
  "jumping-jack": {
    primaryMuscles: ["Cardio"],
    secondaryMuscles: ["Shoulders", "Legs", "Core"],
    steps: [
      "Start standing, feet together, arms at your sides.",
      "Jump the feet out wide while raising the arms overhead.",
      "Jump back to the start position and repeat.",
    ],
    cues: ["Land softly with slightly bent knees.", "Keep a steady rhythm."],
    mistakes: ["Stiff-legged landings.", "Arms not reaching full overhead."],
    breathing: "Steady, rhythmic breathing.",
  },
  "sprint": {
    primaryMuscles: ["Cardio", "Legs"],
    secondaryMuscles: ["Glutes", "Core", "Calves"],
    steps: [
      "Accelerate from a standing or walking start, driving the arms aggressively.",
      "Maintain a slight forward lean from the ankles.",
      "Drive the knees up and push off powerfully with each step.",
    ],
    cues: ["Relaxed face and hands — tension kills speed.", "Drive the elbows back, not across the body."],
    mistakes: ["Over-striding (heel contact far ahead of the center of mass).", "Running with a stiff torso."],
    breathing: "Powerful, rhythmic breathing.",
  },
  "battle-ropes": {
    primaryMuscles: ["Cardio", "Shoulders"],
    secondaryMuscles: ["Core", "Arms", "Back"],
    steps: [
      "Stand with feet shoulder-width, soft knees, gripping one end of each rope.",
      "Alternate raising and slamming each arm in a wave pattern.",
      "Keep the core braced and the hips slightly hinged.",
    ],
    cues: ["Power comes from the hips and core, not just the arms.", "Keep the waves continuous."],
    mistakes: ["Arms going too wide (reduces wave amplitude).", "Standing upright instead of hinging."],
    breathing: "Rhythmic, timed with the wave movement.",
  },
  "box-step-up": {
    primaryMuscles: ["Quads", "Glutes"],
    secondaryMuscles: ["Hamstrings", "Core"],
    steps: [
      "Stand facing a box or bench, place one foot fully on the surface.",
      "Drive through the heel to step up, bringing the trailing leg to meet it.",
      "Step back down and repeat.",
    ],
    cues: ["Press through the heel of the working leg — not the toes.", "Keep the knee tracking over the foot."],
    mistakes: ["Using the trailing leg to push off the floor.", "Leaning forward excessively."],
    breathing: "Exhale stepping up, inhale stepping down.",
  },

  // ── Additional Strength Exercises ─────────────────────────────────────────
  "sumo-deadlift": {
    primaryMuscles: ["Glutes", "Hamstrings"],
    secondaryMuscles: ["Back", "Quads", "Core"],
    steps: [
      "Stand wide with toes pointed out, grip the bar inside the legs.",
      "Hinge, brace the core, flatten the back, take the slack out.",
      "Drive through the floor keeping the chest up and bar close.",
      "Lockout by squeezing the glutes — don't lean back.",
    ],
    cues: ["Push the floor apart with your feet.", "Keep the bar dragging up your legs."],
    mistakes: ["Knees caving inward.", "Rounding the lower back.", "Bar drifting forward."],
    breathing: "Big brace at the bottom, exhale at lockout.",
  },
  "hex-bar-deadlift": {
    primaryMuscles: ["Legs", "Glutes"],
    secondaryMuscles: ["Back", "Core", "Traps"],
    steps: [
      "Stand inside the hex bar, feet hip-width. Hinge and grip the handles.",
      "Brace the core, chest up, and drive through the floor to stand.",
      "Lower by hinging the hips and bending the knees.",
    ],
    cues: ["More quad-friendly than the barbell deadlift.", "Keep the back flat and chest up."],
    mistakes: ["Rounding the back.", "Jerking the bar off the floor."],
    breathing: "Brace at the bottom, exhale standing.",
  },
  "dumbbell-romanian-deadlift": {
    primaryMuscles: ["Hamstrings", "Glutes"],
    secondaryMuscles: ["Back"],
    steps: [
      "Stand holding dumbbells at your thighs, soft knee bend.",
      "Push hips back and lower the dumbbells along your legs, back flat.",
      "Feel a strong hamstring stretch, then drive the hips forward to stand.",
    ],
    cues: ["Keep the dumbbells close to the legs.", "It's a hip hinge — minimal knee bend."],
    mistakes: ["Squatting the weight down.", "Rounding the lower back."],
    breathing: "Inhale hinging, exhale standing.",
  },
  "arnold-press": {
    primaryMuscles: ["Shoulders"],
    secondaryMuscles: ["Triceps"],
    steps: [
      "Hold dumbbells at shoulder height, palms facing you.",
      "Rotate the palms out as you press overhead.",
      "Reverse the rotation as you lower back to the start.",
    ],
    cues: ["Full rotation — start facing you, finish facing forward.", "Controlled on the way down."],
    mistakes: ["Rushing the rotation.", "Leaning the torso back excessively."],
    breathing: "Exhale pressing, inhale lowering.",
  },
  "concentration-curl": {
    primaryMuscles: ["Biceps"],
    steps: [
      "Sit, brace the back of the upper arm against the inner thigh.",
      "Curl the dumbbell up to the shoulder, squeezing the bicep hard.",
      "Lower under control to full extension.",
    ],
    cues: ["Eliminate all swing — the arm is braced.", "Squeeze hard at the top."],
    mistakes: ["Swinging the torso to help.", "Partial range of motion."],
    breathing: "Exhale curling, inhale lowering.",
  },
  "preacher-curl": {
    primaryMuscles: ["Biceps"],
    steps: [
      "Drape the upper arms over the preacher pad, grip the bar underhand.",
      "Curl to full contraction, squeeze, then lower under control to full extension.",
    ],
    cues: ["Lower all the way — full stretch at the bottom is the point.", "Keep elbows on the pad."],
    mistakes: ["Partial reps.", "Leaning away from the pad to heave."],
    breathing: "Exhale curling, inhale lowering.",
  },
  "tricep-dip": {
    primaryMuscles: ["Triceps"],
    secondaryMuscles: ["Front Delts", "Chest"],
    steps: [
      "Place hands on a bench behind you, legs extended or feet flat.",
      "Lower the hips toward the floor by bending the elbows.",
      "Press back up to straight arms.",
    ],
    cues: ["Keep the back close to the bench.", "Elbows track straight back — not out."],
    mistakes: ["Flaring elbows wide.", "Letting the shoulders shrug up."],
    breathing: "Inhale down, exhale up.",
  },
  "incline-barbell-press": {
    primaryMuscles: ["Upper Chest"],
    secondaryMuscles: ["Front Delts", "Triceps"],
    steps: [
      "Set bench to 30–45°. Grip slightly wider than shoulder-width.",
      "Unrack, lower the bar to the upper chest, elbows ~45°.",
      "Press back up to lockout.",
    ],
    cues: ["Keep the shoulder blades pinched and depressed.", "Bar touches the upper chest, not the neck."],
    mistakes: ["Setting the incline too steep.", "Bouncing off the chest."],
    breathing: "Inhale lowering, exhale pressing.",
  },
  "t-bar-row": {
    primaryMuscles: ["Back", "Lats"],
    secondaryMuscles: ["Biceps", "Rear Delts"],
    steps: [
      "Straddle the bar, grip the handle, hinge to ~45° with a flat back.",
      "Row the bar to your lower chest, driving elbows back.",
      "Lower under control to a full stretch.",
    ],
    cues: ["Keep the back flat and the chest up.", "Lead with the elbows."],
    mistakes: ["Using body english to heave.", "Rounding the lower back."],
    breathing: "Exhale rowing, inhale lowering.",
  },
  "cable-lateral-raise": {
    primaryMuscles: ["Side Delts"],
    steps: [
      "Stand sideways to a low pulley, grab the handle with the far hand.",
      "Raise the arm out to the side until level with the shoulder.",
      "Lower under control — constant cable tension.",
    ],
    cues: ["Lead with the elbow, pinky slightly up.", "Cable provides constant tension vs. dumbbells."],
    mistakes: ["Swinging for momentum.", "Shrugging the traps."],
    breathing: "Exhale raising, inhale lowering.",
  },

  // ── Cardio / Full body ───────────────────────────────────────────────────
  "treadmill-run": {
    primaryMuscles: ["Cardio"],
    secondaryMuscles: ["Legs"],
    steps: [
      "Set a comfortable starting speed and a slight incline (1–2%).",
      "Run tall with a relaxed posture and a midfoot strike.",
      "Build pace gradually; cool down by walking at the end.",
    ],
    cues: ["Keep your shoulders relaxed and arms swinging naturally.", "Look ahead, not down."],
    mistakes: ["Holding the handrails the whole time.", "Overstriding (heel slamming way ahead)."],
    breathing: "Rhythmic breathing in sync with your stride.",
  },
  "rowing-machine": {
    primaryMuscles: ["Back", "Legs"],
    secondaryMuscles: ["Core", "Arms", "Cardio"],
    steps: [
      "Strap in, start at the catch: shins vertical, arms straight, leaning slightly forward.",
      "Drive with the legs first, then swing the torso back, then pull the handle to your ribs.",
      "Reverse the order: arms out, hinge forward, then bend the knees to return.",
    ],
    cues: ["Sequence is legs → back → arms, then arms → back → legs.", "Power comes from the legs."],
    mistakes: ["Pulling with the arms first.", "Rounding the back.", "Rushing the recovery."],
    breathing: "Exhale on the drive, inhale on the recovery.",
  },
  "jump-rope": {
    primaryMuscles: ["Cardio", "Calves"],
    steps: [
      "Hold the handles at hip height, elbows close to your sides.",
      "Turn the rope with the wrists and jump just enough to clear it.",
      "Land softly on the balls of your feet.",
    ],
    cues: ["Small jumps — an inch or two is enough.", "Spin from the wrists, not the arms."],
    mistakes: ["Jumping too high.", "Swinging from the shoulders.", "Stiff, heavy landings."],
    breathing: "Steady, relaxed breathing.",
  },
  burpee: {
    primaryMuscles: ["Full Body"],
    secondaryMuscles: ["Chest", "Legs", "Core", "Cardio"],
    steps: [
      "From standing, squat down and place your hands on the floor.",
      "Kick your feet back into a plank (add a push-up for difficulty).",
      "Jump the feet back to your hands and explode up into a jump.",
    ],
    cues: ["Keep the core braced when you kick back.", "Land softly and reset each rep."],
    mistakes: ["Sagging hips in the plank.", "Rounding the back jumping the feet in."],
    breathing: "Exhale on the jump up, inhale resetting.",
  },
  "kettlebell-swing": {
    primaryMuscles: ["Glutes", "Hamstrings"],
    secondaryMuscles: ["Core", "Back", "Shoulders"],
    steps: [
      "Stand with the bell a foot ahead, hinge and grip it with both hands.",
      "Hike it back between your legs, then explosively snap the hips forward.",
      "Let the hip drive float the bell to chest height; guide it back down into the next hinge.",
    ],
    cues: ["It's a hip hinge, not a squat.", "The power is a glute snap — arms just guide the bell."],
    mistakes: ["Squatting instead of hinging.", "Lifting the bell with the arms/shoulders.", "Overarching the back at the top."],
    breathing: "Exhale forcefully on the hip snap, inhale on the backswing.",
  },
};

export const genericGuide: ExerciseGuide = {
  primaryMuscles: [],
  steps: [
    "Set up in a stable position with a braced core and neutral spine.",
    "Move through a full, controlled range of motion.",
    "Pause briefly at the peak contraction, then return under control.",
  ],
  cues: [
    "Control both the lifting and lowering phases — no momentum.",
    "Keep tension on the target muscle throughout.",
  ],
  mistakes: ["Using momentum to move the weight.", "Cutting the range of motion short."],
  breathing: "Exhale during the effort, inhale on the return.",
};

/** Look up the form guide for an exercise by name (falls back to a generic guide). */
export function guideFor(name: string): ExerciseGuide {
  return GUIDES[slugify(name)] ?? genericGuide;
}

/** Whether a hand-written guide exists for this exercise (vs. the generic fallback). */
export function hasGuide(name: string): boolean {
  return slugify(name) in GUIDES;
}
