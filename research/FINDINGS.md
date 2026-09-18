# Can Jev play chess? Findings and demo plan

Tested on September 18, 2026, with `typesafe/jev-1.13` through OpenRouter.

**Use chess puzzles for the first video. Keep the action simple: Jev chooses one legal move.** The model found the two mate-in-one positions we tried. Its longer game had large mistakes. This makes a good short experiment, but does not support a claim that Jev is a strong chess player.

## What the API supports

Jev is a text-input decision model. It returns a choice from supplied options, a probability for each option, and confidence. It does not take images or generate a free-form explanation.

The working endpoint is `POST https://openrouter.ai/api/alpha/decisions`. This is a separate route from normal chat completions. The request has `model`, `state`, and `questions`. A move question uses `type: "choice"`, `instructions`, and `criteria`.

The key was already set. The first live four-option opening request returned `e2e4` in 389 ms. The full app uses every legal move, not that four-option shortlist.

At test time, OpenRouter listed $0.042 per million input tokens and $0 for output tokens. The UI displays the cost returned by the API rather than an estimate from this price.

## The action design

The game code owns the rules. Jev owns the move choice.

1. Rebuild the position from a known start and the recorded moves.
2. Generate all legal moves.
3. Send the position and one description per move to Jev.
4. Accept only a returned ID from that set.
5. Apply it and show the actual probabilities and time.

For chess, the IDs use UCI notation: a source square and destination square, with an optional promotion piece. `e2e4` moves from e2 to e4. The descriptions name the piece and squares. The input includes FEN, a compact text format for the position, plus a plain list of pieces and their squares. The plain list avoids requiring Jev to decode FEN alone.

The model does not receive the scenario title, expected answer, legal move notation with check or mate suffixes, engine scores, or a search over future positions. The UI can show `Qh4#` after the choice, because the rules code knows it is checkmate. That marker is not in the model's options.

This tests **move selection with supplied legal moves**. It does not test whether Jev knows every rule or can read a board image.

| Action method | Assessment |
| --- | --- |
| One Choice over all legal moves | Best first version. One call, direct action, clear failure boundary, useful probability bars. Implemented. |
| Pick a piece, then a destination | Two decisions can lose the relation between the piece and the move. More calls without a clear gain. |
| Choose from legal and illegal candidates | Could test rule knowledge. Reject illegal choices and report the rate. A separate experiment. |
| Text commands or mouse coordinates | Poor fit. Jev is not a text-generation or vision model. Extra parsing or UI control does not help test its decisions. |
| Give it engine scores or winning-move labels | Can produce better play, but the engine supplies the strategy. Label this as assisted play if added. |

Do not present the probability panel as “Jev's thoughts.” These are returned scores for options. TypeSafe says confidence is a statistic of the distribution. It is not the chance the selected chess move wins the game.

## Small tactical check

Six positions were each tested twice. The second request reversed the order of the legal options. Both runs used the app's normal input format.

| Position | Normal order | Reversed order | Result |
| --- | --- | --- | --- |
| Chess opening | e4 | e4 | Same opening choice; no scored answer |
| Fool's mate position | Qh4# | Qh4# | Found mate in both calls |
| Back-rank mate | Re8# | Re8# | Found mate in both calls |
| Connect Four opening | Column 4 | Column 4 | Same opening choice; no scored answer |
| Connect Four immediate win | Column 7 | Column 4 | Missed once; found it once |
| Connect Four required block | Column 4 | Column 4 | Blocked in both calls |

All 12 requests completed. Median round-trip time was **241 ms**; the range was **198–876 ms**. The eight checks with a defined tactical answer had seven correct choices. The reported total cost was **$0.000480396**.

The mate choices did not always have high confidence. For Fool's mate, confidence was 31% and 37%, though both moves were correct. A confidence gate at 50% would reject both. Do not set a threshold without testing the actual use case.

This is a small, selected sample. Reversing the options also makes a new API call, so this does not isolate order effects from request variation. It does establish that one choice changed. These are not held-out tests, a strength rating, or a reliable latency benchmark.

## State format matters, but did not solve Connect Four

Eight more calls compared two formats on the winning and blocking positions, with both option orders:

- A list of discs in each column, from bottom to top: chose column 7 on all four calls. All were wrong.
- Plain text rows with `R`, `Y`, and `.`: missed the immediate win twice; blocked the threat twice.

The current app keeps the original explicit row arrays. The extra formats did not improve these cases. This is consistent with TypeSafe's documented limits around numeric representations and multi-step reasoning, but it is not proof of the cause of these mistakes.

## Complete self-play runs

One game per type used the same input and action contract as the app. No engine corrected the moves.

**Chess:** 75 half-moves, then a draw by threefold repetition. The opening was `1. e4 Nf6 2. Qh5 Nxh5`. White moved its queen onto a square where Black's knight could take it. Later play included further large material losses and repeated king moves. The game was legal throughout because the app supplied and checked legal options. It was not strong chess.

**Connect Four:** 19 turns, then Red won along the bottom row. Both sides repeatedly filled column 4, then column 5, then column 3. Red then won in column 2. The result is quick to watch, but the sequence gives little evidence of good planning.

The two runs cost a reported **$0.00414582** in total. Their full choices, probabilities, and times are saved in `selfplay.json`. The 12 baseline calls, eight state-format calls, and 94 self-play turns total 114 saved research calls. Browser checks made a few additional calls.

## Which game makes the best video?

| Idea | Why it works | Main limit | Recommendation |
| --- | --- | --- | --- |
| Chess mate-in-one sprint | Familiar board, immediate result, revealing choice scores | A few puzzles do not measure general chess skill | Best first clip; implemented |
| Full chess self-play | The early queen loss is a clear, funny surprise | Long stretches can be slow or repetitive | Use the opening, not a whole match |
| Connect Four | Viewers see the goal at once; only seven actions | Our tests show spatial errors and repeated column choices | Good visual second clip; implemented |
| Small dungeon with action cards | Readable choices such as attack, shield, heal, or flee match a text decision model | Needs a new game and testing; strength is unknown | Best next game to prototype |
| Tic-tac-toe | Very simple setup | Little suspense after a few turns | Useful smoke test, weak headline |
| Snake or real-time platforming | Clear motion and visible failures | Network delay is large relative to the control rate | Avoid for the first version |
| Minesweeper | Easy to show a loss | Often needs multi-step logic or a guess | Poor fit for an honest first showcase |

A dungeon could use a simple fixed state: player health, an enemy's announced next action, and three or four action cards. Code computes damage, healing, and the legal actions. Jev selects a card. It would test decisions described in words while keeping arithmetic in code. This is a design recommendation, not a tested result.

## A 25-second video

Suggested title: **“Can a decision model play chess?”**

1. **0–4 seconds:** show the board and title. Caption: “Every legal move goes in. One choice comes back.”
2. **4–10 seconds:** choose “Find the finish,” then press “Ask Jev to move.” Leave the probability bars and measured time visible.
3. **10–17 seconds:** try the back-rank puzzle. Show the actual result, including any miss.
4. **17–23 seconds:** show the opening of self-play. The saved run loses a queen on White's second move. A new live run may differ.
5. **23–25 seconds:** caption: “Finds a mate. Still hangs a queen. What should it play next?”

Use the full desktop page for a landscape capture. The phone layout stacks the board above the results. Turn on the optional move sound. Export the session to retain the exact results. If you use the saved run, label it as a replay. Do not label an edited clip as an uncut live match.

## Sources

- [OpenRouter model page](https://openrouter.ai/typesafe/jev-1.13): model type, modalities, and listed price.
- [OpenRouter Decisions API](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request): request and response format.
- [TypeSafe Choice](https://docs.typesafe.ai/primitives/choice): options, probabilities, and structured descriptions.
- [TypeSafe state](https://docs.typesafe.ai/concepts/state): text-only input and state design.
- [TypeSafe confidence](https://docs.typesafe.ai/confidence): confidence versus option probability.
- [Jev 1.13 known limits](https://docs.typesafe.ai/model-jaggedness/jev-1.13): generation, numeric precision, and multi-step reasoning limits.

## Validation

Eleven automated tests passed. They cover legal replay, mate, castling, en passant, promotion, repetition, Connect Four wins and full columns, invalid model output, private error handling, request boundaries, and concurrent calls. Browser checks covered a human move and Jev reply in both games, chess checkmate, desktop layout, and phone layout. No npm security issues were reported for the one runtime dependency.
