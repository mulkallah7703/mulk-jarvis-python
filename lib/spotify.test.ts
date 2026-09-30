import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { matchSpotify, resetSpotifyLines, spotifyLine, spotifyTarget } from "./spotify.ts";

describe("spotify intents", () => {
  it("matches the live transcripts that missed, including punctuation and a leading wake", () => {
    for (const phrase of [
      "افتح spotify.",
      "Open Spotify.",
      "kora open spotify",
      "Kora, open Spotify.",
      "شغل spotify",
      "افتح سبوتيفي.",
      "spotty fly",
      "spot a fi",
      "open  Spotify!",
      "افتح، spotify؟",
    ]) {
      const intent = matchSpotify(phrase);
      assert.ok(intent, phrase);
      assert.equal(intent.kind, "open", phrase);
      assert.equal(intent.query, "", phrase);
      const target = spotifyTarget(intent);
      assert.equal(target.uri, "spotify:", phrase);
      assert.equal(target.web, "https://open.spotify.com", phrase);
    }
  });

  it("opens Spotify home for a plain open command", () => {
    for (const phrase of ["open spotify", "Open Spotify", "please open the spotify", "افتح سبوتيفاي", "افتح سبوتفاي"]) {
      const intent = matchSpotify(phrase);
      assert.ok(intent, phrase);
      assert.equal(intent.kind, "open", phrase);
      assert.equal(intent.query, "", phrase);
      const target = spotifyTarget(intent);
      assert.equal(target.uri, "spotify:");
      assert.equal(target.web, "https://open.spotify.com");
    }
  });

  it("opens a popular search when the user just says play music", () => {
    for (const phrase of ["play music", "play some music", "put on a song", "شغل موسيقى", "شغل أغاني", "حط موسيقى"]) {
      const intent = matchSpotify(phrase);
      assert.ok(intent, phrase);
      assert.equal(intent.kind, "play", phrase);
      assert.equal(intent.query, "", phrase);
      const target = spotifyTarget(intent);
      assert.equal(target.uri, "spotify:search:top%20hits");
      assert.equal(target.web, "https://open.spotify.com/search/top%20hits");
    }
  });

  it("searches the named track or artist", () => {
    const english = matchSpotify("play Fairuz on spotify");
    assert.ok(english);
    assert.equal(english.query, "Fairuz");
    assert.equal(spotifyTarget(english).uri, "spotify:search:Fairuz");
    assert.equal(spotifyTarget(english).web, "https://open.spotify.com/search/Fairuz");

    const songs = matchSpotify("شغل أغاني فيروز");
    assert.ok(songs);
    assert.equal(songs.query, "فيروز");
    assert.equal(spotifyTarget(songs).uri, `spotify:search:${encodeURIComponent("فيروز")}`);
    assert.equal(spotifyTarget(songs).web, `https://open.spotify.com/search/${encodeURIComponent("فيروز")}`);

    const named = matchSpotify("شغل عبدالمجيد في سبوتيفاي");
    assert.ok(named);
    assert.equal(named.query, "عبدالمجيد");
    assert.equal(spotifyTarget(named).uri, `spotify:search:${encodeURIComponent("عبدالمجيد")}`);
    assert.equal(spotifyTarget(named).web, `https://open.spotify.com/search/${encodeURIComponent("عبدالمجيد")}`);

    const duo = matchSpotify("play Daft Punk on spotify");
    assert.ok(duo);
    assert.equal(duo.query, "Daft Punk");
    assert.equal(spotifyTarget(duo).uri, "spotify:search:Daft%20Punk");
    assert.equal(spotifyTarget(duo).web, "https://open.spotify.com/search/Daft%20Punk");
  });

  it("rotates a short witty confirmation in the command language", () => {
    const cases: { raw: string; query: string }[] = [
      { raw: "open spotify", query: "" },
      { raw: "play music", query: "" },
      { raw: "play Fairuz on spotify", query: "Fairuz" },
      { raw: "افتح سبوتيفاي", query: "" },
      { raw: "شغل موسيقى", query: "" },
      { raw: "شغل أغاني فيروز", query: "فيروز" },
    ];
    for (const item of cases) {
      resetSpotifyLines();
      const intent = matchSpotify(item.raw);
      assert.ok(intent, item.raw);
      const seen = new Set<string>();
      let previous = "";
      for (let index = 0; index < 24; index += 1) {
        const line = spotifyLine(item.raw, intent, () => index / 24);
        assert.equal(line.includes("."), true, line);
        assert.equal((line.match(/[.!?؟]/g) || []).length, 1, line);
        assert.notEqual(line, previous);
        if (item.query) assert.equal(line.includes(item.query), true, line);
        previous = line;
        seen.add(line);
      }
      assert.ok(seen.size >= 8 && seen.size <= 10, `${item.raw} ${seen.size}`);
    }
  });

  it("leaves ordinary sentences to Gemini", () => {
    for (const phrase of [
      "what is spotify",
      "play football",
      "play the guitar",
      "I listen to music sometimes",
      "شغل التلفزيون",
      "وش رايك في سبوتيفاي",
      "what time is it",
      "كم الساعة",
      "Quota.",
    ]) {
      assert.equal(matchSpotify(phrase), null, phrase);
    }
  });
});
