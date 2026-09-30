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
    wordCount: 25,
  },
  {
    id: "en-beg-002",
    content:
      "she sells sea shells by the sea shore the shells she sells are surely sea shells so if she sells shells on the seashore",
    difficulty: "beginner",
    category: "common",
    wordCount: 24,
  },
  {
    id: "en-beg-003",
    content:
      "typing is a skill that improves with practice every day you type you build muscle memory and your fingers begin to find the right keys faster than before",
    difficulty: "beginner",
    category: "common",
    wordCount: 28,
  },
  {
    id: "en-beg-004",
    content:
      "good morning how are you today I am doing well thank you the weather is nice outside and I plan to go for a walk later in the afternoon",
    difficulty: "beginner",
    category: "common",
    wordCount: 29,
  },

  // Intermediate
  {
    id: "en-int-001",
    content:
      "The development of artificial intelligence has accelerated dramatically over the past decade. Machine learning models now perform tasks that were once considered exclusively human. From image recognition to natural language processing, these systems continue to surprise researchers with their capabilities.",
    difficulty: "intermediate",
    category: "technical",
    wordCount: 40,
  },
  {
    id: "en-int-002",
    content:
      "Effective communication is the foundation of any successful organization. Whether you are writing an email, delivering a presentation, or participating in a meeting, clarity of thought and precision of language can make the difference between confusion and understanding.",
    difficulty: "intermediate",
    category: "business",
    wordCount: 38,
  },
  {
    id: "en-int-003",
    content:
      "Remote work has fundamentally changed how teams collaborate. Developers, designers, and product managers now coordinate across time zones using digital tools. Asynchronous communication has become essential, requiring written clarity that was previously conveyed through in-person conversation.",
    difficulty: "intermediate",
    category: "business",
    wordCount: 36,
  },
  {
    id: "en-int-004",
    content:
      "Data structures are the building blocks of efficient programs. Arrays, linked lists, trees, and hash maps each have distinct performance characteristics. Choosing the right data structure for a problem can reduce algorithmic complexity from quadratic to linear time.",
    difficulty: "intermediate",
    category: "technical",
    wordCount: 38,
  },
  {
    id: "en-int-005",
    content:
      "The keyboard layout you use affects your typing speed and comfort. QWERTY was designed in the 1870s to prevent mechanical typewriter jams. Alternative layouts like Dvorak and Colemak claim to reduce finger movement and increase efficiency, though switching requires significant retraining.",
    difficulty: "intermediate",
    category: "common",
    wordCount: 41,
  },

  // Advanced
  {
    id: "en-adv-001",
    content:
      "Cryptographic hash functions produce a fixed-size digest from arbitrary input, exhibiting avalanche effects where a single bit change cascades throughout the output. SHA-256, used extensively in blockchain protocols and certificate verification, generates a 256-bit hash through a series of bitwise operations, modular additions, and compression functions applied iteratively.",
    difficulty: "advanced",
    category: "technical",
    wordCount: 48,
  },
  {
    id: "en-adv-002",
    content:
      "The phenomenological approach to consciousness, pioneered by Husserl and elaborated by Heidegger and Merleau-Ponty, challenges the Cartesian distinction between mind and body. By emphasizing lived experience, intentionality, and the embodied nature of perception, phenomenologists argue that cognition cannot be fully understood through computational abstraction alone.",
    difficulty: "advanced",
    category: "academic",
    wordCount: 45,
  },
  {
    id: "en-adv-003",
    content:
      "Distributed systems must contend with the CAP theorem, which states that a networked system can guarantee at most two of three properties: consistency, availability, and partition tolerance. Database architects designing globally distributed applications must make explicit trade-offs, typically sacrificing strict consistency for availability during network partitions.",
    difficulty: "advanced",
    category: "technical",
    wordCount: 46,
  },

  // Long — enough words for every words-test length (WORD_COUNTS, up to 200).
  // The migration 20260930000000_words_mode_passages inserts the same text into
  // existing databases. Keep the two identical when editing (a test enforces it).
  {
    id: "en-long-001",
    content:
      "Learning to type well is less about speed and more about rhythm. When you first sit down at a keyboard, every letter feels like a small search, and your eyes jump between the screen and your hands. With steady practice, that search fades away. Your fingers learn where each key lives, and the words begin to flow without conscious effort. The secret is to slow down at the start. Typing accurately at a gentle pace builds the right habits, while rushing tends to lock in mistakes that are hard to unlearn later. Keep your wrists relaxed and your shoulders loose, and let your fingers return to the home row after each stroke. Short sessions every day are far more useful than one long session each week, because the brain needs time to turn practice into memory. It also helps to type real sentences rather than random letters, since everyday writing contains the patterns you will use most often. Over time you will notice that common words like the, and, and that seem to type themselves. When that happens, you can gradually raise your pace and focus on the words that still slow you down. Progress may feel slow from one day to the next, but over a few weeks the improvement is often remarkable. Patience and consistency are what turn a careful beginner into a fluent typist.",
    difficulty: "intermediate",
    category: "common",
    wordCount: 227,
  },
  {
    id: "en-long-002",
    content:
      "Every successful project begins with a clear understanding of the problem it is meant to solve. Before a team writes a plan or sets a deadline, it should agree on who the work is for, what those people need, and how everyone will know when the job is done. This early conversation can feel slow, but it saves a great deal of time later, because it prevents the team from building the wrong thing well. Once the goal is clear, the work can be divided into small pieces that each deliver something useful on their own. Small pieces are easier to estimate, easier to review, and easier to change when new information arrives. Regular check-ins keep everyone aligned, and a short written summary after each meeting makes sure that decisions are not forgotten. Good teams also plan for risk. They ask what could go wrong, how likely it is, and what they would do if it happened. A simple list of risks, reviewed every few weeks, turns unpleasant surprises into problems the team has already discussed. Finally, a project is not finished when the last task is closed. The team should look back on what went well and what did not, and share those lessons openly. Honest reflection is how a group of capable individuals slowly becomes a truly effective team.",
    difficulty: "intermediate",
    category: "business",
    wordCount: 221,
  },
  {
    id: "en-long-003",
    content:
      "When you open a website, a surprising amount of work happens in less time than it takes to blink. Your browser first asks a name server to translate the address you typed into a numeric location on the network. It then opens a secure connection to that server, agreeing on encryption keys so that nobody in between can read or change the data. Next, the browser requests the page, and the server replies with a document written in a markup language that describes its structure. That document usually points to other files, such as style sheets that control colors and layout, scripts that add interactive behavior, and images that fill the screen. The browser fetches each of these, often several at once, and begins to build a model of the page in memory. It calculates where every element should appear, paints the pixels, and runs the scripts, which may request even more data in the background. Caching makes later visits much faster, because files that have not changed can be loaded from local storage instead of the network. Developers measure all of these steps carefully, since a delay of even a fraction of a second can cause visitors to leave. Understanding this journey helps engineers find the slow parts and build pages that feel instant to the people who use them.",
    difficulty: "intermediate",
    category: "technical",
    wordCount: 221,
  },
  {
    id: "en-long-004",
    content:
      "Cities are often described as crowded and loud, yet many of them hide quiet places that reward anyone willing to explore on foot. A walk through an old neighborhood can reveal narrow lanes, small gardens behind iron gates, and buildings whose stone walls have watched several centuries pass. Early in the morning, before the traffic builds, you can hear birds in the trees and the soft sounds of shops opening for the day. Bakers pull fresh bread from their ovens, and the smell drifts out onto the street. Walking slowly lets you notice details that are invisible from a car or a bus, such as painted tiles above a doorway, a carved date on a bridge, or a tiny park where neighbors meet to talk. Many cities now protect these spaces by closing some streets to cars, planting new trees, and building wide paths for people on foot and on bicycles. These changes make the air cleaner and the streets safer, and they encourage people to spend more time outdoors. A regular walk is also good for health, since it strengthens the heart and clears the mind. The next time you have an hour to spare, leave the map at home, choose a direction, and let the city show you something new.",
    difficulty: "intermediate",
    category: "common",
    wordCount: 212,
  },
  {
    id: "en-long-005",
    content:
      "Software testing is the practice of checking that a program does what it is supposed to do, and that it keeps doing so as the code changes over time. The simplest tests, often called unit tests, examine one small function at a time. They give the function a known input and confirm that it returns the expected output. Because they are small and fast, a project can run thousands of them in a few seconds after every change. Integration tests go one step further and check that several parts of a system work correctly together, such as a web service and the database it depends on. These tests are slower, but they catch problems that unit tests cannot see, like a query that fails only on a real database. End-to-end tests drive the finished application the way a person would, clicking buttons and filling in forms in a real browser. A healthy project uses all three kinds in sensible proportions, with many quick unit tests and fewer slow end-to-end tests. Good tests are clear about what they check, independent of one another, and reliable enough that a failure always means something. When a bug is found in production, a careful team first writes a test that reproduces it, then fixes the code, so the same mistake can never quietly return.",
    difficulty: "intermediate",
    category: "technical",
    wordCount: 220,
  },
];

// ─── Certificate Passages ─────────────────────────────────────────────────────

/**
 * Certificate passages. Each must last a full certificate test at
 * CERTIFICATE_PASSAGE_TARGET_WPM: a certificate test that runs out of text
 * ends early and is INVALID (see CERTIFICATE_MIN_PASSAGE_CHARS). Plain ASCII
 * only, so every character can be typed on any keyboard layout.
 *
 * The database is seeded from this list, and the migration
 * 20260925000000_long_certificate_passages inserts the same text into
 * existing databases. Keep the two identical when editing (a test enforces it).
 */
const certificatePassages: Passage[] = [
  {
    id: "cert-001",
    content:
      "The ability to type quickly and accurately is a valuable professional skill in today's digital workplace. Whether you are drafting emails, entering data, writing reports, or coding software, keyboard proficiency directly affects your productivity. Regular practice builds muscle memory, and your fingers gradually learn to reach the correct keys without conscious effort. " +
      "Professional typists achieve speeds of sixty words per minute or more while maintaining accuracy above ninety-five percent. This combination of speed and precision requires consistent training, attention to posture, and correct finger placement on the home row keys. The home row consists of A, S, D, F for the left hand and J, K, L, and semicolon for the right. " +
      "Developing good typing habits early prevents repetitive strain injuries and maximizes long-term performance. Take regular breaks, keep your wrists in a neutral position, and avoid resting them on the desk while actively typing. " +
      "Touch typing means typing without looking at the keyboard. Instead of searching for each letter, you rely on the position of your hands and the feel of the keys under your fingertips. Most keyboards have small raised bumps on the F and J keys so that you can find the home row by touch alone. From there, each finger is responsible for a small group of keys above and below its resting position. When every finger knows its own territory, your hands can stay relaxed and your eyes can stay on the screen, where they belong. " +
      "Learning to touch type can feel slow at first. Many people notice that their speed drops for a week or two while their fingers adjust to the new movements. This is normal and temporary. The old habit of hunting for keys with two or three fingers has a low ceiling, while touch typing keeps improving for years with steady practice. A few short sessions every day are far more effective than one long session each week, because the brain consolidates motor skills during rest. " +
      "Accuracy should always come before speed. It is tempting to push for a higher number, but every mistake costs time to notice, delete, and correct. A typist who works at a steady, comfortable pace with very few errors will usually finish a document sooner than one who rushes and constantly stops to fix mistakes. When you practice, try slowing down until you can type a passage almost perfectly, and then increase your pace gradually. Speed follows naturally once the correct movements become automatic. " +
      "Rhythm is another important part of good typing. Skilled typists tend to press keys at an even tempo rather than in sudden bursts followed by pauses. An even rhythm reduces tension in the hands and makes errors less likely. Some people find it helpful to read a few words ahead of the word they are typing, so that their fingers always know what is coming next. Others focus on typing whole words as single movements rather than as separate letters. Both approaches help to smooth out the flow of keystrokes. " +
      "Your environment matters as well. Adjust your chair so that your feet rest flat on the floor and your elbows are bent at roughly a right angle. The top of the monitor should be at or slightly below eye level, and the screen should sit about an arm's length away. Good lighting reduces eye strain, and a tidy desk leaves room for your arms to move freely. Small changes like these can make long typing sessions noticeably more comfortable. " +
      "Finally, remember that typing is a tool rather than a goal in itself. The real purpose of a fast and accurate typing speed is to let your thoughts reach the page without friction. When you no longer have to think about where the keys are, you can give your full attention to what you want to say, whether that is a clear email to a colleague, a careful report for a client, or a few lines of well written code. That freedom is the true reward for the time you invest in practice.",
    difficulty: "intermediate",
    category: "certificate",
    wordCount: 670,
  },
  {
    id: "cert-002",
    content:
      "Data entry is a critical function across industries including healthcare, finance, logistics, and government services. Accurate data entry ensures that records are reliable, decisions are well-informed, and operations run smoothly. " +
      "A skilled data entry professional types at a consistent pace, double-checks their work, and uses keyboard shortcuts to minimize reliance on the mouse. Speed and accuracy are both important: high speed with poor accuracy creates costly errors, while high accuracy at very low speed reduces overall output. " +
      "Training programs typically measure performance in words per minute and characters per minute, with accuracy percentages calculated over the total keystrokes entered. Most professional standards require a minimum of thirty to forty words per minute with ninety-eight percent accuracy for entry-level positions, rising to sixty or more words per minute for advanced roles. " +
      "Before any data can be entered, it must be read and understood. Source documents are not always neat. Handwriting can be difficult to read, forms may be incomplete, and the same piece of information can appear in different formats on different pages. A careful operator reads each field completely before typing it, rather than glancing at the first few characters and guessing the rest. When something is unclear, the right response is to flag the record for review instead of entering a best guess, because a confident mistake is much harder to find later than an honest question. " +
      "Consistency is one of the most valuable qualities in a data set. Names, addresses, dates, and reference numbers should follow the same format in every record, so that they can be searched, sorted, and compared reliably. Most organizations publish a style guide that explains how each field should be written, such as whether to abbreviate street names or how to record a date. Following these rules may feel slow at first, but it saves a great deal of time for everyone who uses the information afterwards. Many systems also use validation checks that reject entries in the wrong format, which helps to catch simple errors before they are saved. " +
      "Verification is the final step that separates good data entry from average work. Some teams use double entry, where two people type the same records independently and a program compares the results. Any difference between the two versions is investigated and resolved. Other teams rely on sampling, where a supervisor checks a portion of each batch against the original documents. In either case, the goal is the same: to find and correct errors before they affect reports, invoices, or decisions. An accuracy rate that looks high on paper can still hide thousands of mistakes when the volume of records is large. " +
      "Confidentiality is just as important as accuracy. Data entry professionals often handle personal details, medical histories, financial records, and other sensitive information. They are expected to follow strict privacy rules, lock their screens when they step away, and never share what they have seen with anyone who does not need to know. Trust is earned slowly and lost quickly, and a single careless moment can expose people to real harm. Good habits, such as clearing the desk of printed documents at the end of the day, protect both the organization and the people whose records it holds. " +
      "Long periods of repetitive work can be tiring, and fatigue is one of the main causes of errors. Experienced operators plan short breaks throughout the day, stretch their hands and shoulders, and look away from the screen regularly to rest their eyes. They also learn to recognize the signs that their concentration is slipping, such as rereading the same line several times or making small mistakes in familiar words. Stopping for a few minutes at that point is far more productive than pushing on and creating work that will have to be checked and corrected later. " +
      "Technology continues to change the way data is collected, and some information is now captured automatically by scanners and online forms. Even so, skilled people remain essential. Someone must review the records that automated tools cannot read, resolve conflicts between sources, and decide what to do when the data does not fit the expected pattern. The combination of fast, accurate typing and sound judgment is what makes a data entry professional valuable, and it is a combination that improves with every hour of careful practice.",
    difficulty: "intermediate",
    category: "certificate",
    wordCount: 716,
  },
  {
    id: "cert-003",
    content:
      "Clear writing is one of the most useful skills in any workplace. Every day, people send messages, write reports, update records, and prepare documents that others must read and act upon. When the writing is clear, work moves forward smoothly. When it is vague or confusing, people waste time asking questions, making assumptions, and correcting misunderstandings. The good news is that clear writing is not a special talent. It is a set of simple habits that anyone can learn and improve with practice. " +
      "The first habit is to know your purpose before you begin. Ask yourself what the reader needs to know and what you want them to do after reading. A message that tries to cover too many topics at once often achieves none of them. If you have several unrelated points to make, consider sending separate messages or using headings so that each point is easy to find. Putting the most important information at the beginning also helps, because many readers will only skim the first few lines. " +
      "The second habit is to choose plain words over complicated ones. Short, familiar words are easier to read and harder to misunderstand. There is rarely a good reason to write utilize when use will do, or to say at this point in time when you simply mean now. The same principle applies to sentences. A long sentence with many clauses forces the reader to hold several ideas in mind at once, while two or three shorter sentences can carry the same meaning with far less effort. " +
      "The third habit is to be specific. Instead of writing that a project will be finished soon, give a date. Instead of asking someone to look at the numbers, tell them which numbers and what you are concerned about. Specific writing may take a moment longer to prepare, but it prevents the back and forth that vague writing creates. It also shows respect for the reader, who can act on your message immediately instead of trying to guess what you meant. " +
      "Tone matters as much as content. Written messages lack the facial expressions and tone of voice that soften spoken words, so a short reply that feels efficient to the writer can seem cold or even rude to the reader. A brief greeting, a word of thanks, and a polite closing take only a few seconds to type and can make a real difference to how a message is received. When you need to deliver difficult news, it is usually best to be direct and kind at the same time, explaining the situation honestly and offering a way forward. " +
      "Editing is where good writing becomes great writing. Very few people produce a perfect draft on the first attempt. After you finish writing, read the message again from the point of view of the person who will receive it. Remove words that do not add meaning, fix any spelling or grammar mistakes, and check that names, dates, and figures are correct. For important documents, it can help to wait a little while before reviewing them, or to ask a colleague to read them with fresh eyes. " +
      "Structure helps readers find their way through longer documents. A report should begin with a short summary of its main findings, followed by the details that support them. Headings, numbered steps, and short paragraphs break the text into pieces that are easy to scan. Lists are useful for items that belong together, such as the actions agreed in a meeting or the documents needed for an application. When every part of a document has a clear job, readers can go straight to the section they need and trust that nothing important is hidden elsewhere. " +
      "Typing skill supports all of these habits. When your fingers move easily across the keyboard, you can focus on your ideas instead of on the mechanics of getting them onto the screen. Fast and accurate typing also makes editing less of a chore, because rewriting a sentence takes only a moment. Over time, the combination of confident typing and thoughtful writing becomes a genuine advantage, helping you to communicate clearly, work efficiently, and earn the trust of the people who depend on your words.",
    difficulty: "intermediate",
    category: "certificate",
    wordCount: 699,
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

  const pool = englishPassages.filter((p) => p.difficulty === difficulty);

  if (pool.length === 0) {
    // Fallback to intermediate
    const fallback = englishPassages.filter((p) => p.difficulty === "intermediate");
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
