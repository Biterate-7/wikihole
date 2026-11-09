import type { TrailDefinition } from "./types";

/**
 * Hand-written trails. Every step follows a link that exists in the earlier
 * article on English Wikipedia (tests/live/trails.live.test.ts checks this
 * against the live site), and every explanation restates what the linked
 * articles themselves say. Nothing here is a guess: if Wikipedia does not
 * state a relationship, it is not a step.
 *
 * Titles are canonical article titles (no redirects, no disambiguation pages).
 * Payoffs are written about the destination, so they still read correctly
 * when a trail is joined part-way through.
 */
export const CURATED_TRAILS: TrailDefinition[] = [
  {
    id: "moon-landing-to-arpanet",
    origin: "curated",
    titles: ["Apollo 11", "Space Race", "Sputnik crisis", "DARPA", "ARPANET"],
    connections: [
      {
        summary: "The Moon landing was the culmination of the Space Race.",
        detail:
          "Apollo 11 settled the Space Race, the competition in spaceflight between the United States and the Soviet Union that grew out of their Cold War rivalry.",
      },
      {
        summary: "The race began in earnest with the shock of Sputnik.",
        detail:
          "When the Soviet Union launched Sputnik 1, the first artificial satellite, in October 1957, the alarm it caused in the West became known as the Sputnik crisis.",
      },
      {
        summary: "Sputnik prompted the United States to create a new research agency.",
        detail:
          "In February 1958 President Eisenhower authorised the Advanced Research Projects Agency, ARPA (later DARPA), to develop emerging technologies for the US military.",
      },
      {
        summary: "ARPA funded and built an experimental computer network.",
        detail:
          "ARPA's Information Processing Techniques Office played a vital role in creating ARPANET, a packet-switched network whose technology became the foundation of the Internet.",
      },
    ],
    payoff:
      "ARPANET's first computers were connected in 1969, the same year as Apollo 11: the Internet's ancestor and the Moon landing grew from the same Cold War shock.",
  },
  {
    id: "moon-rocket-to-v2",
    origin: "curated",
    titles: ["Apollo 11", "Saturn V", "Wernher von Braun", "V-2 rocket"],
    connections: [
      {
        summary: "Apollo 11 was launched on a Saturn V.",
        detail: "The Saturn V super heavy-lift rocket carried the Apollo 11 crew from Kennedy Space Center towards the Moon in July 1969.",
      },
      {
        summary: "The Saturn V's design was led by Wernher von Braun.",
        detail:
          "The rocket's technical design was led by engineers relocated from Germany after the Second World War, most notably Wernher von Braun.",
      },
      {
        summary: "Before coming to America, von Braun built Germany's V-2.",
        detail:
          "During the Second World War von Braun helped design and develop the V-2 at the Peenemünde Army Research Center, and was brought to the United States in 1945 under Operation Paperclip.",
      },
    ],
    payoff:
      "The rocket that took humans to the Moon was led by the engineer behind the V-2, a Second World War weapon and the first human-made object to reach space.",
  },
  {
    id: "moon-computer-to-microwave",
    origin: "curated",
    titles: ["Apollo 11", "Apollo Guidance Computer", "Core rope memory", "Raytheon", "Microwave oven"],
    connections: [
      {
        summary: "Apollo 11 was steered by the Apollo Guidance Computer.",
        detail:
          "Each Moon flight carried two Apollo Guidance Computers, one in the command module and one in the lunar module, at the centre of guidance, navigation and control.",
      },
      {
        summary: "Its software was stored in core rope memory.",
        detail:
          "Most of the computer's software lived in core rope memory, read-only memory made by weaving wires through and around tiny magnetic cores.",
      },
      {
        summary: "The memory was woven by hand at Raytheon, which built the computer.",
        detail:
          "Raytheon manufactured the flight hardware, and the programs written at MIT were woven into rope memory by women working in its factories.",
      },
      {
        summary: "Raytheon also invented the microwave oven.",
        detail:
          "In 1945 Raytheon engineer Percy Spencer found that the magnetrons the company made for radar could heat food quickly; Raytheon sold the first commercial microwave oven in 1947.",
      },
    ],
    payoff:
      "The company that wove Apollo's software into memory by hand also sold the world's first microwave oven, two decades earlier.",
  },
  {
    id: "microwave-to-tizard-mission",
    origin: "curated",
    titles: ["Microwave oven", "Percy Spencer", "Cavity magnetron", "Tizard Mission"],
    connections: [
      {
        summary: "Percy Spencer is credited with inventing the microwave oven.",
        detail:
          "Spencer, an engineer at Raytheon, developed and patented the first commercial microwave oven, the Radarange, after, as the story goes, an active radar set melted a candy bar in his pocket.",
      },
      {
        summary: "Spencer was mass-producing cavity magnetrons for radar.",
        detail:
          "During the Second World War Spencer found a faster way to make magnetrons, the microwave-generating tubes inside radar sets, raising Raytheon's output from 100 to 2,600 a day.",
      },
      {
        summary: "Britain gave the cavity magnetron to the US on the Tizard Mission.",
        detail:
          "In September 1940, with Britain short of money and factories, a British delegation led by Henry Tizard carried a prototype magnetron to America in exchange for industrial help.",
      },
    ],
    payoff:
      "The kitchen microwave descends from a secret wartime radar device that a historian called “the most valuable cargo ever brought to our shores”.",
  },
  {
    id: "loom-to-lord-byron",
    origin: "curated",
    titles: ["Loom", "Jacquard machine", "Analytical engine", "Ada Lovelace", "Lord Byron"],
    connections: [
      {
        summary: "The Jacquard machine let a loom weave complex patterns automatically.",
        detail:
          "Patented by Joseph Marie Jacquard in 1804, the device attached to a loom and raised each warp thread under the control of a chain of punched cards.",
      },
      {
        summary: "Its punched cards inspired Babbage's Analytical Engine.",
        detail:
          "Using replaceable punched cards to control a sequence of operations inspired Charles Babbage, who planned to feed programs and data into his Analytical Engine the same way.",
      },
      {
        summary: "Ada Lovelace published the first program written for the engine.",
        detail:
          "In 1843 Lovelace translated and annotated a description of the Analytical Engine; her Note G, a method for calculating Bernoulli numbers, is often called the first published computer program.",
      },
      {
        summary: "Ada Lovelace was Lord Byron's daughter.",
        detail: "She was the only legitimate child of the poet Lord Byron, who separated from her mother a month after Ada was born.",
      },
    ],
    payoff: "A device for weaving patterned silk leads, by way of the first computer program, to the Romantic poet Lord Byron.",
  },
  {
    id: "pencil-to-ig-nobel",
    origin: "curated",
    titles: ["Pencil", "Graphite", "Graphene", "Andre Geim", "Ig Nobel Prize"],
    connections: [
      {
        summary: "A pencil's “lead” is mostly graphite.",
        detail: "Most pencil cores are graphite powder mixed with a clay binder; despite the name, they contain no lead.",
      },
      {
        summary: "Graphite is many stacked layers of graphene.",
        detail:
          "Graphite is made of sheets of carbon one atom thick, called graphene, held together by weak forces that let the layers slide apart.",
      },
      {
        summary: "Andre Geim isolated graphene using graphite and sticky tape.",
        detail:
          "In 2004 Geim and Konstantin Novoselov at the University of Manchester peeled graphene from a piece of graphite with adhesive tape, work that earned them the 2010 Nobel Prize in Physics.",
      },
      {
        summary: "Geim had already won an Ig Nobel Prize, for levitating a frog.",
        detail:
          "In 2000 Geim and Michael Berry received an Ig Nobel Prize for using magnetism to levitate a live frog, an experiment that grew out of research into magnetism and water.",
      },
    ],
    payoff: "The physicist who pulled graphene from pencil graphite is the only person to have won both a Nobel Prize and an Ig Nobel Prize.",
  },
  {
    id: "coffee-to-lloyds",
    origin: "curated",
    titles: ["Coffee", "Coffeehouse", "Lloyd's Coffee House", "Lloyd's of London"],
    connections: [
      {
        summary: "Coffee spread through Europe in coffeehouses.",
        detail:
          "After the first coffeehouses opened in the Ottoman Empire, they appeared in Venice in 1647 and soon in Oxford and London, where they became places to trade news.",
      },
      {
        summary: "One London coffeehouse, Lloyd's, catered to the shipping trade.",
        detail:
          "Edward Lloyd's coffee house, opened in 1686, drew sailors, merchants and shipowners, and Lloyd kept them supplied with reliable shipping news.",
      },
      {
        summary: "Insurance deals struck there became Lloyd's of London.",
        detail:
          "Underwriters met at Lloyd's to insure ships and their cargo, and their business grew into the Lloyd's of London insurance market.",
      },
    ],
    payoff: "One of the world's best-known insurance markets is named after a seventeenth-century coffee house.",
  },
  {
    id: "banana-to-crystal-palace",
    origin: "curated",
    titles: ["Banana", "Cavendish banana", "Joseph Paxton", "The Crystal Palace"],
    connections: [
      {
        summary: "The banana sold in most Western shops is the Cavendish.",
        detail: "Cavendish cultivars dominate the global banana trade and are the main kind eaten in the Western world.",
      },
      {
        summary: "The Cavendish was first cultivated by Joseph Paxton.",
        detail:
          "Paxton, head gardener to the 6th Duke of Devonshire, grew the banana in the greenhouses at Chatsworth House and named it Musa cavendishii after the Duke.",
      },
      {
        summary: "Paxton went on to design the Crystal Palace.",
        detail:
          "Drawing on his experience building large glasshouses, Paxton designed the Crystal Palace, the iron-and-glass hall built in Hyde Park for the Great Exhibition of 1851.",
      },
    ],
    payoff: "The everyday supermarket banana and the Victorian Crystal Palace come from the same gardener's greenhouses.",
  },
  {
    id: "purple-to-gin-and-tonic",
    origin: "curated",
    titles: ["Purple", "Mauveine", "Quinine", "Tonic water", "Gin and tonic"],
    connections: [
      {
        summary: "Mauve, the first synthetic purple dye, made the colour affordable.",
        detail:
          "Before mauveine, purple dyes were costly enough that only the wealthy wore the colour; Perkin's industrial process made mauve available to almost anyone.",
      },
      {
        summary: "Mauveine was discovered by accident, in an attempt to make quinine.",
        detail:
          "In 1856 the 18-year-old chemist William Henry Perkin was trying to synthesise quinine, the anti-malarial drug, when he produced the purple dye instead.",
      },
      {
        summary: "Quinine is what gives tonic water its bitter taste.",
        detail:
          "Tonic water began as a way to take medicinal quinine: British officials in the tropics mixed it with soda and sugar to mask its bitterness while guarding against malaria.",
      },
      {
        summary: "Tonic water was mixed with gin, and the drink stuck.",
        detail:
          "British officers stationed in India in the nineteenth century added gin to their quinine tonic, and the gin and tonic outlived its medical purpose.",
      },
    ],
    payoff: "A fashion for purple and the gin and tonic share a single bitter ingredient: quinine, the anti-malarial drug Perkin failed to make.",
  },
];

/** The trail shown first: the clearest example of an ordinary start and an unexpected end. */
export const FEATURED_TRAIL_ID = "moon-landing-to-arpanet";
