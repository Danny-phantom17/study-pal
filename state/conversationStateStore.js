function createConversationStateStore() {
  const phases = new Map(); // chatId -> 'quiz' | 'explanation' | 'ai_chat' | 'idle'

  function setPhase(chatId, phase) {
    phases.set(chatId, phase);
  }

  function getPhase(chatId) {
    return phases.get(chatId) || 'idle';
  }

  function clearPhase(chatId) {
    phases.delete(chatId);
  }

  return { setPhase, getPhase, clearPhase };
}

module.exports = { createConversationStateStore };