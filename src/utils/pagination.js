const PAGINATION_DEFAULT_PAGE = 1;
const PAGINATION_DEFAULT_LIMIT = 10;
const PAGINATION_MAX_LIMIT = 100;
const EVENTS_DEFAULT_LIMIT = 50;

const parsePagination = (query) => {
  const page = parseInt(query.page, 10);
  const limit = parseInt(query.limit, 10);
  return {
    enabled: Object.prototype.hasOwnProperty.call(query, 'page') || Object.prototype.hasOwnProperty.call(query, 'limit'),
    page: Number.isInteger(page) && page >= PAGINATION_DEFAULT_PAGE ? page : PAGINATION_DEFAULT_PAGE,
    limit: Number.isInteger(limit) && limit >= 1 ? Math.min(limit, PAGINATION_MAX_LIMIT) : PAGINATION_DEFAULT_LIMIT
  };
};

// Aplica solo los defaults del par limit/offset. No convierte a numero ni limita
// el maximo: la coercion (parseInt) sigue a cargo del call site, que hoy la hace
// eventController y no eventSourcingService.
const parseOffsetLimit = (source) => {
  const { limit = EVENTS_DEFAULT_LIMIT, offset = 0 } = source;
  return { limit, offset };
};

module.exports = {
  PAGINATION_DEFAULT_PAGE,
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
  EVENTS_DEFAULT_LIMIT,
  parsePagination,
  parseOffsetLimit
};
