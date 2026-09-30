import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { matchSpotify, spotifyLine, spotifyTarget } from "./spotify.ts";

describe("spotify intents", () => {
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

  it("speaks a short confirmation in the command language", () => {
    const open = matchSpotify("open spotify");
    assert.ok(open);
    assert.equal(spotifyLine("open spotify", open), "Spotify's open. Don't just stand there.");
    const play = matchSpotify("play music");
    assert.ok(play);
    assert.equal(spotifyLine("play music", play), "Spotify's open. The taste is still on you.");
    const query = matchSpotify("play Fairuz on spotify");
    assert.ok(query);
    assert.equal(spotifyLine("play Fairuz on spotify", query), "Searching Spotify for Fairuz. Try not to skip the good part.");
    const arabic = matchSpotify("افتح سبوتيفاي");
    assert.ok(arabic);
    assert.equal(spotifyLine("افتح سبوتيفاي", arabic), "فتحت سبوتيفاي. الباقي عليك.");
    const arabicPlay = matchSpotify("شغل موسيقى");
    assert.ok(arabicPlay);
    assert.equal(spotifyLine("شغل موسيقى", arabicPlay), "حاضر. سبوتيفاي مفتوح. اختار شي فيه ذوق.");
    const arabicQuery = matchSpotify("شغل أغاني فيروز");
    assert.ok(arabicQuery);
    assert.equal(spotifyLine("شغل أغاني فيروز", arabicQuery), "أدور لك على فيروز في سبوتيفاي. لا تتأخر.");
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
    ]) {
      assert.equal(matchSpotify(phrase), null, phrase);
    }
  });
});
