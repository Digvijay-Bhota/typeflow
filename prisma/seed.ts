import { PrismaClient, Language, CodeLanguage, Difficulty } from '@prisma/client';
import { englishPassages, certificatePassages } from '../src/features/typing/lib/passages';

const prisma = new PrismaClient();

const codePassages = [
  {
    content: "function calculateWpm(correctChars, elapsedMs) {\n  const minutes = elapsedMs / 60000;\n  return (correctChars / 5) / minutes;\n}",
    language: Language.CODE,
    codeLanguage: CodeLanguage.JAVASCRIPT,
    difficulty: Difficulty.BEGINNER,
    mode: "NORMAL" as any,
  },
  {
    content: "export const useTypingEngine = (config: EngineConfig) => {\n  const [state, setState] = useState(initialState);\n  \n  useEffect(() => {\n    if (state.active) {\n      startTimer();\n    }\n  }, [state.active]);\n\n  return { state };\n};",
    language: Language.CODE,
    codeLanguage: CodeLanguage.TYPESCRIPT,
    difficulty: Difficulty.INTERMEDIATE,
    mode: "NORMAL" as any,
  },
  {
    content: "def get_user_by_id(user_id: int) -> dict:\n    \"\"\"Fetch user from database.\"\"\"\n    db = get_db_connection()\n    cursor = db.cursor()\n    cursor.execute(\"SELECT * FROM users WHERE id = ?\", (user_id,))\n    return cursor.fetchone()",
    language: Language.CODE,
    codeLanguage: CodeLanguage.PYTHON,
    difficulty: Difficulty.INTERMEDIATE,
    mode: "NORMAL" as any,
  },
  {
    content: "public static void main(String[] args) {\n    System.out.println(\"Hello, World!\");\n    \n    for (int i = 0; i < 10; i++) {\n        if (i % 2 == 0) {\n            System.out.println(i + \" is even\");\n        }\n    }\n}",
    language: Language.CODE,
    codeLanguage: CodeLanguage.JAVA,
    difficulty: Difficulty.BEGINNER,
    mode: "NORMAL" as any,
  },
  {
    content: "SELECT u.id, u.username, COUNT(o.id) as order_count\nFROM users u\nLEFT JOIN orders o ON u.id = o.user_id\nWHERE u.status = 'ACTIVE'\nGROUP BY u.id, u.username\nHAVING COUNT(o.id) > 5\nORDER BY order_count DESC;",
    language: Language.CODE,
    codeLanguage: CodeLanguage.SQL,
    difficulty: Difficulty.INTERMEDIATE,
    mode: "NORMAL" as any,
  },
  {
    content: "#include <iostream>\n#include <vector>\n\nint main() {\n    std::vector<int> numbers = {1, 2, 3, 4, 5};\n    \n    for (const auto& num : numbers) {\n        std::cout << num << std::endl;\n    }\n    \n    return 0;\n}",
    language: Language.CODE,
    codeLanguage: CodeLanguage.CPP,
    difficulty: Difficulty.BEGINNER,
    mode: "NORMAL" as any,
  }
];

async function main() {
  console.log("Seeding code passages...");
  for (const passage of codePassages) {
    const existing = await prisma.passage.findFirst({ where: { content: passage.content } });
    if (!existing) {
      await prisma.passage.create({
        data: {
          ...passage,
          wordCount: passage.content.split(/\s+/).length,
          charCount: passage.content.length,
          isActive: true,
        }
      });
    }
  }

  console.log("Seeding english passages...");
  for (const p of englishPassages) {
    const existing = await prisma.passage.findFirst({ where: { content: p.content } });
    if (!existing) {
      await prisma.passage.create({
        data: {
          content: p.content,
          language: Language.ENGLISH,
          category: p.category,
          difficulty: p.difficulty.toUpperCase() as Difficulty,
          mode: "NORMAL" as any,
          wordCount: p.wordCount,
          charCount: p.content.length,
          isActive: true,
        }
      });
    }
  }

  console.log("Seeding certificate passages...");
  for (const p of certificatePassages) {
    const existing = await prisma.passage.findFirst({ where: { content: p.content } });
    if (!existing) {
      await prisma.passage.create({
        data: {
          content: p.content,
          language: Language.ENGLISH,
          category: p.category,
          difficulty: p.difficulty.toUpperCase() as Difficulty,
          mode: "CERTIFICATE" as any,
          wordCount: p.wordCount,
          charCount: p.content.length,
          isActive: true,
        }
      });
    }
  }

  console.log("Seeding complete!");
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
