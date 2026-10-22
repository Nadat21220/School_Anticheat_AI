import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { QuestionRecord } from "@proctoring/shared";

/**
 * Carga del banco de preguntas (ADR-011): un archivo JSON estático,
 * leído una sola vez al iniciar el proceso y mantenido en memoria.
 */

const moduleDir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BANK_PATH = join(moduleDir, "../../questions/exam-default.json");

export class QuestionBank {
  readonly orderedIds: readonly string[];
  private readonly byId: ReadonlyMap<string, QuestionRecord>;

  constructor(questions: readonly QuestionRecord[]) {
    if (questions.length === 0) {
      throw new Error("El banco de preguntas no puede estar vacío.");
    }
    this.byId = new Map(questions.map((question) => [question.id, question]));
    this.orderedIds = questions.map((question) => question.id);
  }

  get(id: string): QuestionRecord {
    const question = this.byId.get(id);
    if (!question) {
      throw new Error(`Pregunta desconocida en el banco: ${id}`);
    }
    return question;
  }

  get size(): number {
    return this.orderedIds.length;
  }
}

export function loadQuestionBank(path: string = process.env.QUESTION_BANK_PATH ?? DEFAULT_BANK_PATH): QuestionBank {
  const raw = readFileSync(path, "utf-8");
  const questions = JSON.parse(raw) as QuestionRecord[];
  return new QuestionBank(questions);
}
