export function quizPage<T>(questions: T[], requestedIndex: number) {
  if (questions.length === 0) {
    return {
      question: null,
      position: 0,
      total: 0,
      isFirst: true,
      isLast: true,
    };
  }
  const index = Math.max(0, Math.min(requestedIndex, questions.length - 1));
  return {
    question: questions[index],
    position: index + 1,
    total: questions.length,
    isFirst: index === 0,
    isLast: index === questions.length - 1,
  };
}
