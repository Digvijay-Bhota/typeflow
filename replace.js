const fs = require('fs');

function processFile(path) {
  let content = fs.readFileSync(path, 'utf8');
  content = content.replace(/  \} catch \(error: any\) \{\n    const isPrisma = error\.name\?\.includes\("Prisma"\) \|\| error\.message\?\.includes\("Prisma"\);\n    const safeMessage = isPrisma \? "Database operation failed" : error\.message;\n    return NextResponse\.json\(\{ error: safeMessage \}, \{ status: 400 \}\);\n  \}/g, 
  `  } catch (error: any) {
    if (isServiceError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status || 400 });
    }
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 400 });
  }`);
  
  content = content.replace(/  \} catch \(error: any\) \{\n    const isPrisma = error\.name\?\.includes\("Prisma"\) \|\| error\.message\?\.includes\("Prisma"\);\n    const safeMessage = isPrisma \? "Database operation failed" : error\.message;\n    return NextResponse\.json\(\{ error: safeMessage \}, \{ status: 403 \}\);\n  \}/g, 
  `  } catch (error: any) {
    if (isServiceError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status || 403 });
    }
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 403 });
  }`);
  
  fs.writeFileSync(path, content);
}

processFile('src/app/api/org/[orgId]/assessments/[assessmentId]/candidates/route.ts');
processFile('src/app/api/org/[orgId]/assessments/[assessmentId]/candidates/[candidateId]/review/route.ts');
