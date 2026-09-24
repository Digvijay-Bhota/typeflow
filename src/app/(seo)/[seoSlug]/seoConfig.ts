export const ALLOWED_SEO_ROUTES = [
  "typing-test",
  "1-minute-typing-test",
  "3-minute-typing-test",
  "5-minute-typing-test",
  "english-typing-test",
  "hindi-typing-test",
  "code-typing-test",
  "javascript-typing-test",
  "typescript-typing-test",
  "python-typing-test",
  "java-typing-test",
  "cpp-typing-test",
  "sql-typing-test",
  "typing-test-for-beginners",
  "typing-test-with-certificate",
  "typing-speed-guide",
  "how-wpm-is-calculated",
  "how-to-increase-typing-speed",
];

const sharedLinks = [
  { title: "1 Minute Typing Test", href: "/1-minute-typing-test" },
  { title: "Code Typing Test", href: "/code-typing-test" },
  { title: "Hindi Typing Test", href: "/hindi-typing-test" },
];

export function getSeoRouteConfig(slug: string) {
  switch (slug) {
    case "typing-test":
      return {
        title: "Free Typing Test Online - Check Your WPM",
        description:
          "Take our free online typing test to measure your Words Per Minute (WPM), accuracy, and typing speed. Practice typing and track your progress instantly.",
        h1: "Free Online Typing Test",
        introduction:
          "Welcome to the ultimate typing test. Whether you are preparing for a job interview, learning to touch type, or just want to see how fast you are, our precise WPM test will give you accurate results in seconds. Choose your duration and start typing!",
        testConfig: {
          mode: "timed" as const,
          language: "english" as const,
          duration: 60,
          trustTier: "FREE" as const,
        },
        faqs: [
          {
            question: "What is a good typing speed?",
            answer:
              "An average typing speed is around 40 WPM. Professional typists typically type over 70 WPM, while advanced typists can reach speeds over 100 WPM.",
          },
          {
            question: "How is WPM calculated?",
            answer:
              "WPM (Words Per Minute) is calculated by dividing the total number of correct characters typed by 5, and then dividing by the total time in minutes.",
          },
        ],
        relatedLinks: [
          { title: "3 Minute Typing Test", href: "/3-minute-typing-test" },
          { title: "English Typing Test", href: "/english-typing-test" },
          {
            title: "How to Increase Typing Speed",
            href: "/how-to-increase-typing-speed",
          },
        ],
      };

    case "1-minute-typing-test":
      return {
        title: "1 Minute Typing Test - Check WPM Speed in 60 Seconds",
        description:
          "Take a fast 1 minute typing test. Measure your words per minute (WPM) and accuracy in exactly 60 seconds with this quick typing assessment.",
        h1: "1 Minute Typing Test",
        introduction:
          "Short on time? The 1-minute typing test is perfect for a quick warm-up or daily practice. In just 60 seconds, you can measure your current WPM and accuracy. Regular short bursts of typing practice are highly effective for building muscle memory.",
        testConfig: {
          mode: "timed" as const,
          language: "english" as const,
          duration: 60,
          trustTier: "FREE" as const,
        },
        faqs: [
          {
            question: "Is a 1-minute test accurate?",
            answer:
              "Yes, a 1-minute test provides a highly accurate snapshot of your burst typing speed. However, longer tests (like 3 or 5 minutes) are better for measuring typing endurance and consistency.",
          },
          {
            question: "What should I focus on in a 60-second test?",
            answer:
              "Focus primarily on accuracy. Speed naturally follows accuracy. Rushing and making mistakes will lower your net WPM due to error penalties.",
          },
        ],
        relatedLinks: [
          { title: "3 Minute Typing Test", href: "/3-minute-typing-test" },
          { title: "5 Minute Typing Test", href: "/5-minute-typing-test" },
        ],
      };

    case "3-minute-typing-test":
      return {
        title: "3 Minute Typing Test - Assess Your Typing Endurance",
        description:
          "Take the 3 minute typing test to accurately evaluate your typing speed (WPM) and endurance over a longer period. Perfect for interview preparation.",
        h1: "3 Minute Typing Test",
        introduction:
          "The 3-minute typing test provides a much more realistic assessment of your true typing capabilities. While 1-minute tests measure sprint speed, a 3-minute test evaluates your typing endurance and sustained accuracy.",
        testConfig: {
          mode: "timed" as const,
          language: "english" as const,
          duration: 180,
          trustTier: "FREE" as const,
        },
        faqs: [
          {
            question: "Why take a 3-minute typing test?",
            answer:
              "Many employers use 3-minute or 5-minute typing tests for candidate assessments because they accurately reflect the stamina required for real-world office work.",
          },
        ],
        relatedLinks: sharedLinks,
      };

    case "5-minute-typing-test":
      return {
        title: "5 Minute Typing Test - Professional Typing Assessment",
        description:
          "The 5 minute typing test is the standard for professional typing certification. Measure your WPM, accuracy, and typing stamina.",
        h1: "5 Minute Typing Test",
        introduction:
          "Welcome to the 5-minute typing test. This is the gold standard length used by recruiters and government agencies to test data entry skills. It requires focus, rhythm, and strong typing endurance.",
        testConfig: {
          mode: "timed" as const,
          language: "english" as const,
          duration: 300,
          trustTier: "FREE" as const,
        },
        faqs: [
          {
            question: "How can I maintain speed for 5 minutes?",
            answer:
              "Maintain good posture, breathe steadily, and keep a consistent rhythm. Don't rush at the beginning; find a comfortable pace where you make very few errors.",
          },
        ],
        relatedLinks: sharedLinks,
      };

    case "english-typing-test":
      return {
        title: "English Typing Test - Practice English Vocabulary",
        description:
          "Practice your English typing speed with our comprehensive English typing test. Features standard punctuation and vocabulary.",
        h1: "English Typing Test",
        introduction:
          "Master the English keyboard layout with our dedicated English typing test. This test features commonly used English words, sentences, and punctuation to help you improve your everyday typing flow.",
        testConfig: {
          mode: "timed" as const,
          language: "english" as const,
          duration: 60,
          trustTier: "FREE" as const,
        },
        faqs: [
          {
            question: "Does punctuation affect my WPM?",
            answer:
              "Yes, our English typing test includes standard punctuation (commas, periods, capital letters) because real-world typing requires mastering these keys.",
          },
        ],
        relatedLinks: sharedLinks,
      };

    case "hindi-typing-test":
      return {
        title: "Hindi Typing Test - Practice Mangal Font & Remington",
        description:
          "Take our free Hindi typing test. Practice typing in Devanagari script, measure your WPM, and improve your Hindi data entry speed.",
        h1: "Hindi Typing Test",
        introduction:
          "Practice typing in Hindi with our dedicated Devanagari script typing test. Measuring your Hindi typing speed is crucial for many government jobs and data entry positions. Start typing below.",
        testConfig: {
          mode: "timed" as const,
          language: "hindi" as const,
          duration: 60,
          trustTier: "FREE" as const,
        },
        faqs: [
          {
            question: "Which layout should I use?",
            answer:
              "You can use any standard Hindi layout installed on your OS (like InScript or Remington/Mangal). The test reads the Unicode characters you type.",
          },
        ],
        relatedLinks: sharedLinks,
      };

    case "code-typing-test":
      return {
        title: "Code Typing Test - For Programmers and Developers",
        description:
          "Test your coding speed. A typing test designed specifically for programmers featuring code snippets, brackets, and syntax.",
        h1: "Code Typing Test",
        introduction:
          "Typing code is vastly different from typing prose. It requires heavy use of symbols, brackets, indentation, and CamelCase. Test your programming typing speed with real code snippets.",
        testConfig: {
          mode: "timed" as const,
          language: "code" as const,
          duration: 60,
          trustTier: "FREE" as const,
        },
        faqs: [
          {
            question: "Why do programmers need a different typing test?",
            answer:
              "Standard typing tests focus on alphabetic characters. Programmers spend significant time typing symbols like {}, [], (), and ;, which require different muscle memory.",
          },
        ],
        relatedLinks: [
          { title: "JavaScript Typing Test", href: "/javascript-typing-test" },
          { title: "Python Typing Test", href: "/python-typing-test" },
          { title: "TypeScript Typing Test", href: "/typescript-typing-test" },
        ],
      };

    case "javascript-typing-test":
      return {
        title: "JavaScript Typing Test - Practice JS Syntax",
        description:
          "Improve your JavaScript coding speed. Practice typing JS functions, arrays, and ES6 syntax accurately.",
        h1: "JavaScript Typing Test",
        introduction:
          "Practice typing real JavaScript code. Master the muscle memory for arrow functions, template literals, and common JS paradigms.",
        testConfig: {
          mode: "timed" as const,
          language: "code" as const,
          codeLanguage: "javascript" as const,
          duration: 60,
          trustTier: "FREE" as const,
        },
        faqs: [
          {
            question: "Does this test include ES6 syntax?",
            answer:
              "Yes, the test includes modern JavaScript syntax including const/let, arrow functions, and destructuring.",
          },
        ],
        relatedLinks: sharedLinks,
      };

    case "typescript-typing-test":
      return {
        title: "TypeScript Typing Test - Practice TS Types & Interfaces",
        description:
          "Improve your TypeScript coding speed. Practice typing TS interfaces, types, generics, and strict syntax.",
        h1: "TypeScript Typing Test",
        introduction:
          "TypeScript requires typing a lot of angle brackets, colons, and interface definitions. Practice your TS muscle memory here.",
        testConfig: {
          mode: "timed" as const,
          language: "code" as const,
          codeLanguage: "typescript" as const,
          duration: 60,
          trustTier: "FREE" as const,
        },
        faqs: [],
        relatedLinks: sharedLinks,
      };

    case "python-typing-test":
      return {
        title: "Python Typing Test - Practice Python Indentation",
        description:
          "Practice your Python coding speed. Master Python specific indentation, underscores, and def/class syntax.",
        h1: "Python Typing Test",
        introduction:
          "Python's syntax relies heavily on indentation (spaces/tabs), colons, and underscores (snake_case). Test your Python typing speed and accuracy.",
        testConfig: {
          mode: "timed" as const,
          language: "code" as const,
          codeLanguage: "python" as const,
          duration: 60,
          trustTier: "FREE" as const,
        },
        faqs: [
          {
            question: "Is indentation required in this test?",
            answer:
              "Yes, to accurately simulate writing Python, proper indentation must be typed.",
          },
        ],
        relatedLinks: sharedLinks,
      };

    case "java-typing-test":
      return {
        title: "Java Typing Test - Practice Java Syntax",
        description:
          "Practice your Java coding speed. Type public static void main and Java class structures quickly and accurately.",
        h1: "Java Typing Test",
        introduction:
          "Java is known for its verbose syntax. Mastering the quick typing of object-oriented boilerplate, access modifiers, and type declarations will drastically speed up your Java development.",
        testConfig: {
          mode: "timed" as const,
          language: "code" as const,
          codeLanguage: "java" as const,
          duration: 60,
          trustTier: "FREE" as const,
        },
        faqs: [],
        relatedLinks: sharedLinks,
      };

    case "cpp-typing-test":
      return {
        title: "C++ Typing Test - Practice C++ Syntax",
        description:
          "Practice your C++ coding speed. Master typing pointers, references, templates, and complex standard library syntax.",
        h1: "C++ Typing Test",
        introduction:
          "C++ syntax is uniquely dense with symbols, angle brackets, and double colons. Practice typing modern C++ quickly and accurately.",
        testConfig: {
          mode: "timed" as const,
          language: "code" as const,
          codeLanguage: "cpp" as const,
          duration: 60,
          trustTier: "FREE" as const,
        },
        faqs: [],
        relatedLinks: sharedLinks,
      };

    case "sql-typing-test":
      return {
        title: "SQL Typing Test - Practice Database Queries",
        description:
          "Practice typing SQL queries. Master SELECT, JOIN, and database syntax typing speed.",
        h1: "SQL Typing Test",
        introduction:
          "Writing SQL queries involves a mix of ALL CAPS keywords, parentheses, and standard variable names. Practice your SQL typing speed here.",
        testConfig: {
          mode: "timed" as const,
          language: "code" as const,
          codeLanguage: "sql" as const,
          duration: 60,
          trustTier: "FREE" as const,
        },
        faqs: [],
        relatedLinks: sharedLinks,
      };

    case "typing-test-for-beginners":
      return {
        title: "Typing Test for Beginners - Start Learning to Type",
        description:
          "A beginner-friendly typing test with easy words and no complex punctuation. Perfect for kids and adults learning to touch type.",
        h1: "Typing Test for Beginners",
        introduction:
          "If you are just learning how to type, this test is for you. Focus on finding the keys without looking at the keyboard. Don't worry about speed—focus entirely on accuracy and technique.",
        testConfig: {
          mode: "timed" as const,
          language: "english" as const,
          duration: 60,
          trustTier: "FREE" as const,
        },
        faqs: [
          {
            question: "Where should my hands rest?",
            answer:
              "Place your index fingers on the 'F' and 'J' keys (they usually have small bumps). This is called the home row.",
          },
        ],
        relatedLinks: sharedLinks,
      };

    case "typing-test-with-certificate":
      return {
        title: "Typing Test with Certificate - Verify Your WPM",
        description:
          "Take a verifiable typing test and earn a certificate to prove your typing speed to employers.",
        h1: "Typing Test with Certificate",
        introduction:
          "Many employers require proof of typing speed. Take our high-integrity test designed to prevent cheating and provide a shareable, verifiable result.",
        testConfig: {
          mode: "timed" as const,
          language: "english" as const,
          duration: 300,
          trustTier: "CERTIFICATE" as const,
        },
        faqs: [
          {
            question: "Is this certificate officially accredited?",
            answer:
              "No online typing test certificate is universally 'government-approved'. However, our certificates use strict anti-cheat measures and provide employers with cryptographic proof that the test was taken fairly.",
          },
        ],
        relatedLinks: sharedLinks,
      };

    case "typing-speed-guide":
      return {
        title: "Typing Speed Guide - Average WPM & Benchmarks",
        description:
          "What is a good typing speed? Learn about average WPM benchmarks, professional typing requirements, and how to improve.",
        h1: "Complete Typing Speed Guide",
        introduction:
          "Understanding typing speed benchmarks helps you set realistic goals. An average typist reaches about 40 Words Per Minute (WPM). Data entry professionals often type between 60 and 80 WPM. Competitive typists can exceed 120 WPM. Test your current speed below to see where you stand.",
        testConfig: {
          mode: "timed" as const,
          language: "english" as const,
          duration: 60,
          trustTier: "FREE" as const,
        },
        faqs: [
          {
            question: "What speed do employers look for?",
            answer:
              "Most administrative jobs require 40-50 WPM. Data entry roles often demand 60+ WPM.",
          },
        ],
        relatedLinks: [
          { title: "How WPM is Calculated", href: "/how-wpm-is-calculated" },
          {
            title: "How to Increase Typing Speed",
            href: "/how-to-increase-typing-speed",
          },
        ],
      };

    case "how-wpm-is-calculated":
      return {
        title: "How WPM is Calculated - Formula & Examples",
        description:
          "Learn exactly how Words Per Minute (WPM) is calculated. Understand raw WPM, net WPM, and the 5-character word standard.",
        h1: "How WPM is Calculated",
        introduction:
          "In typing tests, a 'word' is standardized as exactly 5 characters, including spaces. This prevents the length of words from skewing your score. Raw WPM is (Total Typed Characters / 5) / Time. Net WPM subtracts your uncorrected errors. Try the test below and see the math in action on the result page.",
        testConfig: {
          mode: "timed" as const,
          language: "english" as const,
          duration: 60,
          trustTier: "FREE" as const,
        },
        faqs: [
          {
            question: "Why is a word exactly 5 characters?",
            answer:
              "It creates a standardized benchmark. Otherwise, typing 'a' ten times would inflate your score compared to typing 'encyclopedia' ten times.",
          },
        ],
        relatedLinks: [{ title: "Typing Speed Guide", href: "/typing-speed-guide" }],
      };

    case "how-to-increase-typing-speed":
      return {
        title: "How to Increase Typing Speed - Tips & Practice",
        description:
          "Actionable tips to increase your typing speed and accuracy. Learn touch typing techniques and build muscle memory.",
        h1: "How to Increase Your Typing Speed",
        introduction:
          "The secret to typing faster is focusing entirely on accuracy first. When you touch type (typing without looking at the keyboard), you build deep muscle memory. Memorize the home row (ASDF JKL;). Try a slow, deliberate practice run on the test below.",
        testConfig: {
          mode: "timed" as const,
          language: "english" as const,
          duration: 60,
          trustTier: "FREE" as const,
        },
        faqs: [
          {
            question: "Should I look at the keyboard?",
            answer:
              "No. Looking at the keyboard forces your brain to constantly switch context between the screen and your hands, severely limiting your maximum speed.",
          },
        ],
        relatedLinks: sharedLinks,
      };

    default:
      return null;
  }
}
