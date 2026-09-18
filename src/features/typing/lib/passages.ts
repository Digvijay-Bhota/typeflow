/**
 * TypeFlow Passage Library
 *
 * Original passages written for TypeFlow.
 * All content is original or public domain.
 * No copyrighted text from books, articles, or other sources.
 *
 * Passage categories:
 * - common: everyday vocabulary, good for general practice
 * - business: professional vocabulary
 * - technical: tech/developer vocabulary
 * - beginner: high-frequency, short words
 * - advanced: longer, complex words
 */

import type { Difficulty } from "@/lib/constants";

export interface Passage {
  id: string;
  content: string;
  difficulty: Difficulty;
  category: string;
  wordCount: number;
}

// ─── English Passages ─────────────────────────────────────────────────────────

const englishPassages: Passage[] = [
  // Beginner — high frequency words
  {
    id: "en-beg-001",
    content:
      "the quick brown fox jumps over the lazy dog and runs away from the big red barn near the old oak tree by the river",
    difficulty: "beginner",
    category: "common",
    wordCount: 26,
  },
  {
    id: "en-beg-002",
    content:
      "she sells sea shells by the sea shore the shells she sells are surely sea shells so if she sells shells on the seashore",
    difficulty: "beginner",
    category: "common",
    wordCount: 30,
  },
  {
    id: "en-beg-003",
    content:
      "typing is a skill that improves with practice every day you type you build muscle memory and your fingers begin to find the right keys faster than before",
    difficulty: "beginner",
    category: "common",
    wordCount: 32,
  },
  {
    id: "en-beg-004",
    content:
      "good morning how are you today I am doing well thank you the weather is nice outside and I plan to go for a walk later in the afternoon",
    difficulty: "beginner",
    category: "common",
    wordCount: 34,
  },

  // Intermediate
  {
    id: "en-int-001",
    content:
      "The development of artificial intelligence has accelerated dramatically over the past decade. Machine learning models now perform tasks that were once considered exclusively human. From image recognition to natural language processing, these systems continue to surprise researchers with their capabilities.",
    difficulty: "intermediate",
    category: "technical",
    wordCount: 44,
  },
  {
    id: "en-int-002",
    content:
      "Effective communication is the foundation of any successful organization. Whether you are writing an email, delivering a presentation, or participating in a meeting, clarity of thought and precision of language can make the difference between confusion and understanding.",
    difficulty: "intermediate",
    category: "business",
    wordCount: 42,
  },
  {
    id: "en-int-003",
    content:
      "Remote work has fundamentally changed how teams collaborate. Developers, designers, and product managers now coordinate across time zones using digital tools. Asynchronous communication has become essential, requiring written clarity that was previously conveyed through in-person conversation.",
    difficulty: "intermediate",
    category: "business",
    wordCount: 38,
  },
  {
    id: "en-int-004",
    content:
      "Data structures are the building blocks of efficient programs. Arrays, linked lists, trees, and hash maps each have distinct performance characteristics. Choosing the right data structure for a problem can reduce algorithmic complexity from quadratic to linear time.",
    difficulty: "intermediate",
    category: "technical",
    wordCount: 40,
  },
  {
    id: "en-int-005",
    content:
      "The keyboard layout you use affects your typing speed and comfort. QWERTY was designed in the 1870s to prevent mechanical typewriter jams. Alternative layouts like Dvorak and Colemak claim to reduce finger movement and increase efficiency, though switching requires significant retraining.",
    difficulty: "intermediate",
    category: "common",
    wordCount: 46,
  },

  // Advanced
  {
    id: "en-adv-001",
    content:
      "Cryptographic hash functions produce a fixed-size digest from arbitrary input, exhibiting avalanche effects where a single bit change cascades throughout the output. SHA-256, used extensively in blockchain protocols and certificate verification, generates a 256-bit hash through a series of bitwise operations, modular additions, and compression functions applied iteratively.",
    difficulty: "advanced",
    category: "technical",
    wordCount: 50,
  },
  {
    id: "en-adv-002",
    content:
      "The phenomenological approach to consciousness, pioneered by Husserl and elaborated by Heidegger and Merleau-Ponty, challenges the Cartesian distinction between mind and body. By emphasizing lived experience, intentionality, and the embodied nature of perception, phenomenologists argue that cognition cannot be fully understood through computational abstraction alone.",
    difficulty: "advanced",
    category: "academic",
    wordCount: 48,
  },
  {
    id: "en-adv-003",
    content:
      "Distributed systems must contend with the CAP theorem, which states that a networked system can guarantee at most two of three properties: consistency, availability, and partition tolerance. Database architects designing globally distributed applications must make explicit trade-offs, typically sacrificing strict consistency for availability during network partitions.",
    difficulty: "advanced",
    category: "technical",
    wordCount: 50,
  },
];

// ─── Certificate Passages ─────────────────────────────────────────────────────
// Longer, controlled passages for certificate tests.
// Curated for balanced character distribution.

const certificatePassages: Passage[] = [
  {
    id: "cert-001",
    content:
      "The ability to type quickly and accurately is a valuable professional skill in today's digital workplace. Whether you are drafting emails, entering data, writing reports, or coding software, keyboard proficiency directly affects your productivity. Regular practice builds muscle memory, and your fingers gradually learn to reach the correct keys without conscious effort. " +
      "Professional typists achieve speeds of sixty words per minute or more while maintaining accuracy above ninety-five percent. This combination of speed and precision requires consistent training, attention to posture, and correct finger placement on the home row keys. The home row consists of A, S, D, F for the left hand and J, K, L, and semicolon for the right. " +
      "Developing good typing habits early prevents repetitive strain injuries and maximizes long-term performance. Take regular breaks, keep your wrists in a neutral position, and avoid resting them on the desk while actively typing.",
    difficulty: "intermediate",
    category: "certificate",
    wordCount: 148,
  },
  {
    id: "cert-002",
    content:
      "Data entry is a critical function across industries including healthcare, finance, logistics, and government services. Accurate data entry ensures that records are reliable, decisions are well-informed, and operations run smoothly. " +
      "A skilled data entry professional types at a consistent pace, double-checks their work, and uses keyboard shortcuts to minimize reliance on the mouse. Speed and accuracy are both important: high speed with poor accuracy creates costly errors, while high accuracy at very low speed reduces overall output. " +
      "Training programs typically measure performance in words per minute and characters per minute, with accuracy percentages calculated over the total keystrokes entered. Most professional standards require a minimum of thirty to forty words per minute with ninety-eight percent accuracy for entry-level positions, rising to sixty or more words per minute for advanced roles.",
    difficulty: "intermediate",
    category: "certificate",
    wordCount: 140,
  },
];

// ─── Passage selection ────────────────────────────────────────────────────────

/**
 * Select a passage based on mode, difficulty, and a seed value.
 * The seed ensures different passages are served across sessions
 * while remaining deterministic for a given seed.
 */
export function selectPassage(params: {
  difficulty: Difficulty;
  isCertificate?: boolean;
  seed?: number;
}): Passage {
  const { difficulty, isCertificate = false, seed = Date.now() } = params;

  if (isCertificate) {
    const idx = seed % certificatePassages.length;
    return certificatePassages[idx] ?? certificatePassages[0]!;
  }

  const pool = englishPassages.filter(
    (p) => p.difficulty === difficulty
  );

  if (pool.length === 0) {
    // Fallback to intermediate
    const fallback = englishPassages.filter(
      (p) => p.difficulty === "intermediate"
    );
    const idx = seed % (fallback.length || 1);
    return fallback[idx] ?? englishPassages[0]!;
  }

  const idx = seed % pool.length;
  return pool[idx] ?? pool[0]!;
}

/**
 * Select a fresh passage different from the last one shown.
 */
export function selectNextPassage(params: {
  difficulty: Difficulty;
  lastPassageId?: string;
}): Passage {
  const { difficulty, lastPassageId } = params;

  const pool = englishPassages.filter(
    (p) => p.difficulty === difficulty && p.id !== lastPassageId
  );

  if (pool.length === 0) {
    return englishPassages[0]!;
  }

  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx] ?? pool[0]!;
}

export { englishPassages, certificatePassages };
