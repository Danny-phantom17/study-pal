function nowIsoDateTime() {
  return new Date().toISOString();
}

function nowIsoDate() {
  return nowIsoDateTime().slice(0, 10);
}

module.exports = {
  nowIsoDate,
  nowIsoDateTime,
};
