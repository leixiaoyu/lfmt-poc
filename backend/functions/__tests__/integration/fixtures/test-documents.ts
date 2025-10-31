/**
 * Test Document Fixtures for Integration Tests
 *
 * Provides various document sizes and types for testing the translation pipeline.
 */

export const TEST_DOCUMENTS = {
  /**
   * Minimal document - 1 chunk (~200 words)
   * Fast translation for quick tests
   */
  MINIMAL: `The Art of Translation

Translation is more than just converting words from one language to another.
It requires understanding context, cultural nuances, and the intended meaning
behind the text. A skilled translator must capture not only the literal meaning
but also the tone, style, and emotional impact of the original work.

In today's globalized world, translation services have become increasingly important.
They enable communication across language barriers, facilitate international business,
and make literature and knowledge accessible to people worldwide.

The challenge of translation lies in preserving the essence of the original while
making it natural and fluent in the target language. This delicate balance is what
separates good translation from great translation.`,

  /**
   * Small document - 2-3 chunks (~500 words)
   * Moderate translation time for standard tests
   */
  SMALL: `The History of Language Translation

Chapter 1: Ancient Beginnings

The practice of translation dates back thousands of years to ancient civilizations.
The Rosetta Stone, discovered in 1799, stands as one of the most famous examples
of ancient translation work. This granodiorite stele features the same text in
three different scripts: Ancient Egyptian hieroglyphs, Demotic script, and
Ancient Greek.

Throughout history, translation has played a crucial role in the spread of
knowledge, religion, and culture. The translation of religious texts, such as
the Bible and the Quran, has had profound impacts on societies worldwide.
These translations made sacred texts accessible to people who did not speak
the original languages.

Chapter 2: The Evolution of Translation

During the Middle Ages, translation was primarily carried out by monks and
scholars in monasteries. They painstakingly copied and translated manuscripts
by hand, preserving knowledge from ancient civilizations and making it
accessible to new generations.

The invention of the printing press in the 15th century revolutionized
translation work. Books could be produced in larger quantities, and
translations became more widespread. This technological advancement
facilitated the Renaissance and the Scientific Revolution by making
knowledge more accessible across Europe.

Chapter 3: Modern Translation

In the 20th century, translation became a recognized profession with
established standards and training programs. The founding of organizations
like the International Federation of Translators in 1953 helped to
professionalize the field and establish quality standards.

Today, translation is undergoing another revolution with the advent of
machine translation and artificial intelligence. While human translators
remain essential for capturing nuance and cultural context, AI tools are
becoming increasingly sophisticated and useful for preliminary translations
and understanding foreign language texts.

The future of translation lies in the collaboration between human expertise
and machine efficiency, combining the best of both approaches to break down
language barriers more effectively than ever before.`,

  /**
   * Medium document - 5-7 chunks (~1500 words)
   * Longer translation time for realistic workflow tests
   */
  MEDIUM: `A Comprehensive Guide to Literary Translation

Introduction

Literary translation is one of the most challenging and rewarding forms of
translation work. Unlike technical or legal translation, which focuses primarily
on accuracy and precision, literary translation must also preserve the artistic
qualities of the original text. This includes style, tone, rhythm, and the
author's unique voice.

The literary translator serves as a cultural ambassador, introducing readers
to works they could not otherwise access. Through their work, entire literary
traditions become available to new audiences, enriching the global cultural
landscape and fostering cross-cultural understanding.

Chapter 1: Understanding the Source Text

The first step in any literary translation project is a thorough understanding
of the source text. This goes far beyond simply knowing the literal meaning of
each word. The translator must comprehend the cultural context in which the work
was created, the historical period it represents, and the literary conventions
of that time and place.

Reading the entire work multiple times is essential. The first reading provides
a general understanding of plot and characters. Subsequent readings allow the
translator to notice subtleties, recurring themes, symbolic elements, and the
author's stylistic choices. Taking detailed notes during these readings helps
identify challenges that will need special attention.

Research is a crucial component of this phase. The translator may need to
investigate historical events, cultural practices, geographical locations, or
specialized vocabulary that appears in the text. Understanding these elements
ensures that the translation will be both accurate and meaningful to readers
in the target language.

Chapter 2: Capturing Style and Voice

Every author has a unique voice - a distinctive way of using language that
sets their work apart. This voice is created through word choice, sentence
structure, rhythm, and countless other subtle elements. Preserving this voice
in translation is one of the translator's most important responsibilities.

Some authors write in long, flowing sentences with elaborate descriptions and
complex grammatical structures. Others prefer short, punchy sentences with
spare, direct language. The translator must recognize these stylistic choices
and find ways to recreate them in the target language, even when the grammatical
structures of the two languages differ significantly.

Tone is another critical element. Is the narrator serious or playful? Formal
or colloquial? Optimistic or pessimistic? These qualities must be maintained
in the translation to ensure that readers experience the work as the author
intended.

Chapter 3: Dealing with Untranslatable Elements

Every translator eventually encounters elements that seem impossible to translate
directly. These might include wordplay, puns, culturally specific references, or
words that simply don't have equivalents in the target language.

When faced with untranslatable elements, the translator has several options.
Sometimes a creative adaptation can capture the spirit of the original, even if
the literal meaning is different. Other times, a brief explanation in a footnote
or translator's note may be necessary to help readers understand cultural
references they might otherwise miss.

Idioms and metaphors present particular challenges. Translating them literally
often produces nonsensical or confusing results in the target language. Instead,
the translator must find equivalent expressions that convey the same meaning and
have similar cultural resonance for readers of the target language.

Chapter 4: The Revision Process

No translation is perfect on the first draft. The revision process is where good
translations become great ones. This phase involves reading the translation
multiple times, checking for accuracy, improving flow, and refining word choices.

Many translators find it helpful to set their work aside for a few days between
drafts. This distance allows them to return to the text with fresh eyes and notice
issues they might have missed before. Reading the translation aloud can also help
identify awkward phrasing or rhythm problems.

Comparison with the original remains important throughout revision. The translator
should regularly check passages against the source text to ensure nothing has been
inadvertently lost or distorted. However, it's equally important not to become so
focused on the source that the translation stops reading naturally in the target
language.

Chapter 5: Ethics and Responsibility

Literary translators bear significant responsibility. Their work shapes how
authors and entire literary traditions are perceived by readers in other languages.
A poor translation can damage an author's reputation or cause readers to miss the
qualities that make a work significant.

Transparency is an important ethical principle in translation. Translators should
acknowledge significant changes they've made to accommodate cultural differences
or linguistic constraints. When footnotes or explanatory notes are added, they
should be clearly identified as the translator's additions rather than part of
the original text.

Conclusion

Literary translation is both an art and a craft, requiring linguistic skill,
cultural knowledge, creativity, and dedication. The best literary translations
are invisible in the sense that they read naturally and fluently, allowing readers
to fully engage with the work as if it had been written originally in their language.

Yet paradoxically, translators must also assert their presence as creative artists
in their own right. Each translation is an interpretation, a new creation that
brings the original into dialogue with a new cultural context. Through their work,
translators expand the boundaries of literature and make it truly universal.`,

  /**
   * Large document - 10+ chunks (~3000 words)
   * Long translation time for stress testing
   */
  LARGE: `The Science and Art of Communication

Part I: Foundations of Human Communication

Introduction to Communication Theory

Communication is the foundation of human civilization. From the earliest cave
paintings to modern social media, humans have constantly sought new ways to
share information, express ideas, and connect with one another. The study of
communication examines how we create, transmit, receive, and interpret messages
across various contexts and media.

This comprehensive exploration of communication will examine its many facets:
verbal and nonverbal, written and spoken, formal and informal, technological
and traditional. We will investigate how communication shapes our relationships,
influences our societies, and drives innovation and change.

Chapter 1: The Nature of Communication

Communication is far more complex than simply exchanging words. It involves
multiple layers of meaning, both explicit and implicit. When we communicate,
we transmit not only information but also emotions, attitudes, and cultural
values. Understanding these multiple dimensions is essential for effective
communication.

The basic communication model involves a sender, a message, a medium, and a
receiver. However, this simple model doesn't capture the full complexity of
real-world communication. Context, noise, feedback, and cultural factors all
play crucial roles in determining whether communication succeeds or fails.

Context includes the physical environment, the social setting, the cultural
background, and the psychological state of the communicators. The same words
can mean very different things depending on where, when, and how they are
spoken. Effective communicators are attuned to context and adjust their
approach accordingly.

Chapter 2: Verbal Communication

Language is humanity's most sophisticated communication tool. Through language,
we can express abstract concepts, share complex ideas, coordinate collective
action, and preserve knowledge across generations. Every language represents a
unique way of organizing and understanding the world.

The choice of words matters enormously in communication. Denotation refers to
the literal, dictionary definition of a word, while connotation encompasses the
emotional and cultural associations that word carries. Skilled communicators
choose words carefully, considering both their denotative and connotative meanings.

Grammar and syntax provide the structural framework for language. These rules
determine how words combine to create meaningful sentences. While grammar rules
vary across languages, all languages have systematic ways of organizing information
and expressing relationships between ideas.

Chapter 3: Nonverbal Communication

Research suggests that the majority of communication is nonverbal. Body language,
facial expressions, gestures, posture, eye contact, and tone of voice all convey
meaning alongside our words. Sometimes nonverbal signals reinforce verbal messages;
other times they contradict them, creating confusion or revealing hidden emotions.

Different cultures have different nonverbal communication norms. A gesture that's
friendly in one culture might be offensive in another. The amount of personal space
people maintain, the appropriateness of eye contact, and the meaning of various
facial expressions all vary across cultures. Cross-cultural communication requires
awareness of these differences.

Paralanguage refers to vocal elements that accompany speech but aren't actual
words: pitch, volume, rate, tone, and vocal quality. These elements can completely
change the meaning of identical words. "That's interesting" can express genuine
fascination or sarcastic dismissal, depending on how it's said.

Part II: Communication in Practice

Chapter 4: Interpersonal Communication

Interpersonal communication is the direct, face-to-face exchange between two or
more people. It forms the foundation of our personal relationships and shapes our
sense of identity. Through interpersonal communication, we develop friendships,
build romantic relationships, and navigate family dynamics.

Active listening is perhaps the most important interpersonal communication skill.
It involves fully concentrating on what the other person is saying, understanding
their message, responding thoughtfully, and remembering the conversation. Active
listening requires setting aside our own thoughts and agenda to truly hear the
other person.

Conflict is an inevitable part of interpersonal relationships. However, conflict
itself isn't necessarily negative; what matters is how we handle it. Constructive
conflict resolution involves expressing our own needs clearly while also considering
the other person's perspective. It requires emotional intelligence, patience, and
a willingness to compromise.

Chapter 5: Group Communication

When three or more people communicate, group dynamics come into play. Groups
develop their own cultures, with shared norms, values, and ways of interacting.
Understanding group communication is essential for effective teamwork, productive
meetings, and successful collaboration.

Groups typically move through several stages of development. They begin with
forming, a period of uncertainty when members are getting to know each other and
establishing ground rules. Then comes storming, when conflicts emerge as members
assert their different views and compete for influence. Norming follows, as the
group establishes shared expectations and ways of working together. Finally,
performing represents the stage when the group functions efficiently toward its goals.

Leadership plays a crucial role in group communication. Effective leaders facilitate
discussion, ensure all voices are heard, manage conflicts, keep the group focused
on its objectives, and create an environment where members feel safe contributing
ideas. Leadership can be formal or informal, and it may shift among group members
depending on the situation.

Chapter 6: Public Communication

Public speaking remains one of the most valued communication skills despite being
one of the most feared. Whether presenting to colleagues, addressing a community
meeting, or speaking at a conference, the ability to communicate effectively with
an audience is crucial for professional success and civic engagement.

Effective public speaking begins with thorough preparation. This includes
researching the topic, understanding the audience, organizing the message logically,
and rehearsing the delivery. Great speakers don't just inform; they engage,
persuade, and inspire their audiences.

Adapting to the audience is essential in public communication. Different audiences
have different knowledge levels, interests, values, and expectations. A presentation
that works well for industry experts might confuse a general audience. Effective
speakers consider their audience carefully and tailor their content and style
accordingly.

Chapter 7: Digital Communication

The digital revolution has transformed how we communicate. Email, text messaging,
social media, video conferencing, and countless other technologies have created
new communication channels and possibilities. These technologies enable instant
global communication but also introduce new challenges and complexities.

Digital communication lacks many of the nonverbal cues present in face-to-face
interaction. Tone and intent can be easily misunderstood in text messages and
emails. Emojis and emoticons attempt to add emotional context to digital messages,
but they're imperfect substitutes for the rich nonverbal communication of
in-person interaction.

Social media has democratized public communication, giving everyone a potential
platform to share their voice with a global audience. However, this accessibility
comes with challenges. Misinformation spreads rapidly, online harassment is
common, and the pressure to maintain a curated online persona can be exhausting.
Digital literacy - the ability to navigate digital communication effectively and
critically - has become an essential skill.

Part III: Communication Challenges and Solutions

Chapter 8: Barriers to Effective Communication

Despite its importance, communication frequently fails. Messages are misunderstood,
important information is overlooked, and conflicts arise from miscommunication.
Understanding common communication barriers is the first step toward overcoming them.

Semantic barriers occur when people use the same words but understand them
differently. Jargon, technical terminology, and specialized language can create
understanding gaps between experts and non-experts. Even common words can have
different meanings for different people based on their experiences and cultural
backgrounds.

Psychological barriers include emotions, prejudices, preconceptions, and attitudes
that interfere with objective communication. When we're angry, stressed, or
defensive, we can't listen or respond effectively. Similarly, stereotypes and
biases can prevent us from truly hearing what others are saying.

Physical barriers range from literal distance and poor acoustics to technological
problems like unstable internet connections. The environment in which communication
occurs significantly affects its success. Noise, distractions, and uncomfortable
settings all impede effective communication.

Chapter 9: Improving Communication Skills

Like any skill, communication improves with practice and conscious effort.
Self-awareness is the foundation for improvement. Understanding our own
communication strengths and weaknesses allows us to build on the former and
address the latter.

Seeking feedback is crucial for communication development. We can't see ourselves
as others see us, so input from trusted colleagues, friends, or mentors helps
identify blind spots. Being open to constructive criticism, even when it's
uncomfortable, accelerates growth.

Continuous learning keeps our communication skills sharp and current. Reading
widely expands vocabulary and exposes us to different writing styles. Observing
skilled communicators reveals techniques we can adapt. Taking courses, attending
workshops, and studying communication theory provides structured opportunities
for improvement.

Conclusion: The Future of Communication

Communication continues to evolve as technology advances and societies change.
Artificial intelligence is beginning to mediate human communication through
translation services, chatbots, and predictive text. Virtual and augmented
reality promise to create new dimensions for remote communication. Brain-computer
interfaces might eventually enable direct mind-to-mind communication.

Despite these technological transformations, the fundamental human need to
connect and share meaning remains constant. The principles of effective
communication - clarity, empathy, active listening, and cultural awareness -
will remain relevant regardless of the medium. As we navigate an increasingly
connected world, strong communication skills become ever more essential for
personal fulfillment, professional success, and social progress.

The future belongs to those who can communicate effectively across boundaries:
cultural, linguistic, generational, and technological. By understanding the
principles explored in this guide and continuously refining our skills, we
can become more effective communicators and build a more connected world.`,
};

/**
 * Get document by size category
 */
export const getTestDocument = (
  size: 'MINIMAL' | 'SMALL' | 'MEDIUM' | 'LARGE'
): string => {
  return TEST_DOCUMENTS[size];
};

/**
 * Get document word count
 */
export const getDocumentWordCount = (content: string): number => {
  return content.trim().split(/\s+/).length;
};

/**
 * Get approximate chunk count for a document
 * Based on 3500 tokens per chunk, ~750 words per chunk
 */
export const getApproximateChunkCount = (content: string): number => {
  const wordCount = getDocumentWordCount(content);
  return Math.ceil(wordCount / 750);
};

/**
 * Document metadata for testing
 */
export const DOCUMENT_METADATA = {
  MINIMAL: {
    name: 'minimal-test.txt',
    size: 'MINIMAL',
    wordCount: getDocumentWordCount(TEST_DOCUMENTS.MINIMAL),
    estimatedChunks: getApproximateChunkCount(TEST_DOCUMENTS.MINIMAL),
    estimatedTranslationTime: '30-60 seconds',
  },
  SMALL: {
    name: 'small-test.txt',
    size: 'SMALL',
    wordCount: getDocumentWordCount(TEST_DOCUMENTS.SMALL),
    estimatedChunks: getApproximateChunkCount(TEST_DOCUMENTS.SMALL),
    estimatedTranslationTime: '1-2 minutes',
  },
  MEDIUM: {
    name: 'medium-test.txt',
    size: 'MEDIUM',
    wordCount: getDocumentWordCount(TEST_DOCUMENTS.MEDIUM),
    estimatedChunks: getApproximateChunkCount(TEST_DOCUMENTS.MEDIUM),
    estimatedTranslationTime: '3-5 minutes',
  },
  LARGE: {
    name: 'large-test.txt',
    size: 'LARGE',
    wordCount: getDocumentWordCount(TEST_DOCUMENTS.LARGE),
    estimatedChunks: getApproximateChunkCount(TEST_DOCUMENTS.LARGE),
    estimatedTranslationTime: '8-12 minutes',
  },
};
