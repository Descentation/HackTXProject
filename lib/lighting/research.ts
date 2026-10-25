// Studies behind the app's design. Keep claims to what each study actually tested.
export type Study = {
  title: string;
  did: string; // what the researchers did
  found: string; // what they found
  meaning: string; // what it means for you on a video call
  inApp: string; // which part of Light Coach it supports
  limits: string; // what it does NOT show
  cite: string;
  url: string;
};

export const RESEARCH: Study[] = [
  {
    title: "Light from one side makes you look less trustworthy",
    did:
      "Researchers photographed 30 people under three studio lighting setups: even light from the front, light from about 75° to the side (a classic portrait look), and light from 90° to the side that leaves half the face in shadow. Then 135 adults, aged 20 to 86, rated every face for trustworthiness, attractiveness, and dominance.",
    found:
      "The same faces were rated less trustworthy and less attractive when half the face was in shadow, and more dominant. Even front lighting and the softer portrait lighting did better. The effect was strongest for young and middle-aged faces.",
    meaning:
      "A window or lamp off to one side of your desk can put half your face in shadow. That small setup choice changes how you come across before you say a word.",
    inApp:
      "This is why Light Coach scores \"Even light on both sides\", tells you which way to turn toward the light, and why the virtual light fills in the darker side of your face.",
    limits: "These were still studio photos, not live video calls, and the side light always came from the same side.",
    cite: "Mattavelli, Gorrino, Cesana, De Angelis & Ricciardelli, Frontiers in Psychology, 2022",
    url: "https://www.frontiersin.org/articles/10.3389/fpsyg.2022.948142",
  },
  {
    title: "Camera angle and eye contact shape first impressions",
    did:
      "Researchers at the University of Gothenburg and Stanford made 288 video-call screenshots that varied where the person was looking (into the camera, at other people on screen, or away), how far they sat from the camera, and the camera angle. About 4,000 people around the world rated how sociable, likable, trustworthy, and threatening each person seemed.",
    found:
      "Looking into the camera made people seem more sociable, likable, and engaged than looking at faces on the screen. A camera slightly above eye level also helped. How far people sat from the camera made little difference.",
    meaning:
      "On a call, your camera is your eye contact. Raising your laptop so the camera is at or a little above eye level, and glancing at the camera when you make a key point, makes you come across better.",
    inApp:
      "This is why Light Coach checks framing and tells you to center yourself and tilt your screen until your face sits naturally in the picture.",
    limits: "This study used screenshots, not live video, and it didn't test lighting.",
    cite: "Fauville et al., Technology, Mind, and Behavior, 2022",
    url: "https://tmb.apaopen.org/pub/qunlfsu2/release/2",
  },
  {
    title: "Small video problems cost trust, even in job interviews",
    did:
      "Researchers ran a series of experiments with a sales pitch, a health consultation, and a simulated job interview. Some viewers saw a version with brief video freezes added during natural pauses, so no words were lost. They also looked at 472 real online court hearings.",
    found:
      "Tiny glitches made viewers trust the speaker less and want to hire them less. Trust in the health advice fell from 77% to 61%. In the court hearings, video problems went along with a 12 percentage-point difference in how often people were granted parole. The researchers think glitchy faces feel subtly \"uncanny\".",
    meaning:
      "People judge you through your video, even when what you say is exactly the same. How your video looks is part of your first impression.",
    inApp:
      "Light Coach can't fix your internet, but it fixes the part of your video you control: how clearly and evenly your face is lit.",
    limits: "This study tested freezes and lag, not lighting. It shows that video quality matters, not that lighting alone changes hiring decisions.",
    cite: "Brucks, Johnson & Rifkin, Nature, 2025 (reported by NPR)",
    url: "https://www.npr.org/2025/12/03/nx-s1-5628360/glitchy-video-calls-zoom-teams-creepy-mistrust",
  },
];

export const FAIRNESS: Study = {
  title: "Webcams handle darker skin tones worse",
  did:
    "Imatest, an image-quality testing company, tested six devices, from a $50 webcam to recent smartphones. They used faces across the Monk Skin Tone Scale under different lighting.",
  found:
    "The cheap webcam underexposed the darker-skinned face, making it too dark, while exposing a lighter face fine. Across all devices, color and exposure errors were bigger and less consistent for darker skin tones.",
  meaning:
    "Two people in the same room can look very different on camera. A lighting check that just measures average brightness would wrongly tell someone with darker skin that their face is \"too dark\".",
  inApp:
    "Light Coach judges face brightness by the brightest 10% of your face, the highlights where light actually hits, instead of the average. Well-lit faces of every skin tone have bright highlights, so the check is about the light, not your skin. Test it on people with different skin tones.",
  limits: "This was an industry conference paper, not a peer-reviewed journal study, and we haven't measured Light Coach's fairness on a large group yet.",
  cite: "Borek, Imatest / Electronic Imaging conference, 2024",
  url: "https://www.imatest.com/equity",
};