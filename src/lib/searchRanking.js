/**
 * Weighted ranking layered on top of Fuse's fuzzy name match.
 * Fuse alone only orders by string-distance; two repos with an identical
 * name-match score should still resolve to "the one you actually meant"
 * more often, so a repo you touch often and just updated should usually
 * out-rank an abandoned one with a coincidentally similar name.
 *
 * score = nameMatchScore * 3 + descriptionMatchScore * 1 + recencyScore + starScore
 *  - nameMatchScore: 1 - fuse.score (Fuse scores 0=perfect..1=worst; invert
 *    so higher is better, matching the other components)
 *  - descriptionMatchScore: 1 if the query substring-matches the
 *    description (case-insensitive), else 0 — deliberately coarse; a
 *    second full Fuse pass over descriptions for a personal repo list
 *    (rarely more than a few hundred items) isn't worth the complexity
 *  - recencyScore: linear decay over 365 days, floors at 0 (older repos
 *    aren't penalized further, just stop getting a boost)
 *  - starScore: log(stars+1) scaled down — stops a 10k-star repo from
 *    completely dominating name-relevance, which is what actually matters
 *    for a personal-repo search
 */
function recencyScore(updatedAt) {
  const ageDays = (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, 1 - ageDays / 365);
}

function starScore(stars) {
  return Math.log((stars || 0) + 1) / 10; // log10(~22000)+1 ≈ 1.0 ceiling-ish, deliberately small vs. name weight
}

function descriptionMatchScore(repo, query) {
  if (!repo.description) return 0;
  return repo.description.toLowerCase().includes(query.toLowerCase()) ? 1 : 0;
}

/**
 * `fuseResults` is Fuse's raw output ({ item, score }[]) already filtered
 * to whatever threshold the caller used. Returns items re-sorted by the
 * weighted score, annotated with `_rankScore` for debugging/tuning.
 */
function rank(fuseResults, query) {
  return fuseResults
    .map((r) => {
      const nameMatchScore = 1 - r.score;
      const rankScore =
        nameMatchScore * 3 +
        descriptionMatchScore(r.item, query) * 1 +
        recencyScore(r.item.updated_at) +
        starScore(r.item.stargazers_count);
      return { ...r, _rankScore: rankScore };
    })
    .sort((a, b) => b._rankScore - a._rankScore);
}

module.exports = { rank, recencyScore, starScore, descriptionMatchScore };
