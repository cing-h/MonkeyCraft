// MonkeyCraft ape village: what the villagers say. Monkey sounds per species,
// with the meaning in plain English. All hand-written, so chatter costs no
// tokens and can't say anything odd. None of it claims work is happening:
// lines about the crew's jobs live in EVENT_LINES and are only used when that
// event really happened (see chatter.js).

/** Monkey sounds by species (crew id, or a villager's species key). */
export const SOUNDS = {
  chief: ['Hrrmph.', 'Hrrm-hrrm.', 'Huff-huff!', 'Grrumph.', 'Hoo-hrrm?', 'Hmmf.', 'Hrrr-huff.'],
  scout: ['Whoop-whoop-whooo!', 'Hoo-hoo-HOO!', 'Whoo-wa!', 'Wa-hoo-hoo?', 'Whoop!', 'Hoo-woop-woop!'],
  smith: ['Ooh-ooh-aah-aah!', 'Hoo-hoo-hah!', 'Ooh-ah?', 'Aah-aah!', 'Hoo-ooh!', 'Ooh-ooh-ooh!'],
  archivist: ['Mwah-squeak.', 'Kss-kss.', 'Mmm-squeak?', 'Hrrr-mwah.', 'Kiss-squeak!', 'Mmmwah.'],
  writer: ['Hee-hee!', 'Peep-peep?', 'Hee-hoo!', 'Pip-pip-pip.', 'Hee!', 'Peep-hee?'],
  inspector: ['Grrrumf.', 'Hmmrrf?', 'Krrk-krrk.', 'Rrrumble.', 'Grnk.', 'Hrrrmf!'],
  sage: ['Kii-kii.', 'Kyu-kyu?', 'Kii-yu.', 'Ki-ki-ki.', 'Kyuu.', 'Kii?'],
  ringer: ['HOOOooOOH!', 'Hoo-WAAH!', 'Rrroooh.', 'HOO-hoo?', 'Waaa-hooo!', 'Hrooo.'],
  clerk: ['Chirr-chirr.', 'Tchk-tchk?', 'Chirrup!', 'Tchk.', 'Chrr-chrr-chee!']
};
export const SLEEP_SOUNDS = ['Zzz-hoo…', 'Mmm-zzz…', 'Hnnn… zzz…', 'Zzz… kii…', 'Hrrr… zzz…'];

/** Little conversations between two villagers, A then B (then A, then B). */
export const CONVERSATIONS = [
  ['Nice weather for swinging.', 'Every day is nice weather for swinging.'],
  ['Have you tried the new mangoes?', 'Twice. Then a third time, to be sure.'],
  ['Race you to the big tree!', 'You always win.', 'That\'s why I keep asking.'],
  ['Did you hear the waterfall last night?', 'I heard it all night.', 'Lovely, wasn\'t it?', 'I was trying to sleep.'],
  ['Your fur looks very shiny today.', 'I rolled in the hot spring.', 'Bold choice.'],
  ['Which way is the river?', 'Downhill. It\'s always downhill.'],
  ['Have you seen my favourite stick?', 'Which one?', 'The stick-shaped one.', 'Ah. No.'],
  ['The fireflies are early tonight.', 'They heard there\'d be bananas.'],
  ['Do you think the volcano is awake?', 'Only on Tuesdays.', 'What\'s a Tuesday?'],
  ['I found a leaf shaped like you.', 'Handsome leaf.'],
  ['Shall we groom each other?', 'Only if you start.'],
  ['The Chief looks thoughtful.', 'The Chief always looks thoughtful.', 'Even when napping.'],
  ['I counted the lanterns. Eleven!', 'There are nine.', 'I counted twice.'],
  ['What\'s for dinner?', 'Fruit.', 'And after that?', 'More fruit.'],
  ['Listen… a parrot is copying you.', 'That parrot owes me a banana.'],
  ['My tail is all tangled.', 'You don\'t have a tail.', 'Then what is tangled?'],
  ['Is that a new hat?', 'It\'s a leaf.', 'It suits you.'],
  ['The bridge creaks louder every day.', 'It\'s singing.', 'It\'s complaining.'],
  ['I had a dream about a giant coconut.', 'Did you eat it?', 'It ate me.'],
  ['Look at the sunset!', 'It does that every evening.', 'Still worth a look.'],
  ['Where do butterflies go at night?', 'To butterfly houses.', 'That makes sense.'],
  ['Do lily pads float on purpose?', 'Everything floats on purpose here.'],
  ['I learned a new knot.', 'Show me!', 'I forgot it.'],
  ['The lagoon looks like a mirror today.', 'I waved at myself.', 'Did you wave back?'],
  ['Who left a banana peel on the path?', '…', 'It was you, wasn\'t it.'],
  ['Hear that? The bell tower hums.', 'That\'s the wind.', 'Or a very small bee.'],
  ['Want to play hide-and-seek?', 'Count to ten.', '…one… seven… ten!', 'Too fast!'],
  ['I think it might rain.', 'Then we get wet.', 'Wise words.'],
  ['The flowers are extra pink today.', 'They\'re showing off.'],
  ['How many vines do you think there are?', 'All of them.'],
  ['I stubbed my toe on a root.', 'Which toe?', 'The one I use for climbing.', 'That\'s all of them.'],
  ['Nap time?', 'Nap time.'],
  ['Did the mist come in early?', 'It never really left.'],
  ['I saw a crab near the water.', 'Was it friendly?', 'It waved its claw.', 'That\'s a yes, probably.'],
  ['Your hammock looks comfy.', 'It\'s not a hammock. It\'s a net.', 'Comfy net.'],
  ['Let\'s build a raft!', 'Where would we go?', 'The other side of the lagoon.', 'It\'s the same over there.'],
  ['The moon will be big tonight.', 'Bigger than a coconut?', 'Much bigger.'],
  ['I taught a frog to sit.', 'Frogs always sit.', 'Not like this.'],
  ['Morning!', 'It\'s evening.', 'Evening, then!'],
  ['Who\'s the best climber?', 'Me.', 'I was asking.'],
  ['I like the smell after rain.', 'Me too. Wet leaves and mud.'],
  ['There\'s a new nest in the palm.', 'Birds?', 'Or very small monkeys.'],
  ['Have you seen the stars from the lookout?', 'You can see every one of them.'],
  ['My stomach is rumbling.', 'Mine is humming.', 'Let\'s go find fruit.'],
  ['Do you think the fish are happy?', 'They look busy.'],
  ['I\'m going to swing all the way round the village.', 'Bring back a mango.'],
  ['That cloud looks like a banana.', 'Every cloud looks like a banana to you.'],
  ['Let\'s sing!', 'You start.', 'Hooo…', 'Lovely. Stop now.'],
  ['The breeze is perfect.', 'Not too warm, not too cold.'],
  ['I found the sunny branch.', 'Make room for me.']
  // the culture: the way of the Leaf-Ledger (see docs/culture.md)
  ['Share the fruit you find.', 'And say where the tree is.'],
  ['A branch that hides its rot breaks.', 'So we tell each other when something\'s wrong.', 'Kindly.', 'Kindly, but we tell.'],
  ['Did you add your mark to the Ledger today?', 'Three leaves and a spiral.', 'A good day, then.'],
  ['The carver gave the new totem a face.', 'Whose?', 'Still deciding. It keeps changing its mind.'],
  ['I traded two mangoes for a scroll.', 'What was in it?', 'A better way to find mangoes.'],
  ['Is the drum calling a gathering?', 'Just practice.', 'It sounded important.', 'All drumming sounds important.'],
  ['What\'s the painter painting?', 'The sunset again.', 'It is a very good sunset.'],
  ['The weaver put an eye in the new rug.', 'For seeing clearly.', 'Or for watching who sits on it.'],
  ['Count the lanterns at the Ring tonight.', 'Each one a job well done.', 'The crew have been busy.'],
  ['Ask before you take, and leave the branch as you found it.', 'Grandmother\'s rule.', 'Everyone\'s grandmother\'s rule.'],
  ['The courier brought fresh fruit up to the Ring.', 'Up all those ladders?', 'Up all those ladders.'],
  ['What did you learn today?', 'That the bridge creaks on the third plank.', 'Write it down for the next one.'],
];

/** Things a lone villager mutters to itself. */
export const MUTTERS = [
  'Where did I leave that mango?', 'Hmm, lovely breeze.', 'One more swing, then a nap.', 'I could eat a whole bunch of bananas.',
  'That vine looks sturdy.', 'I wonder what\'s behind the waterfall.', 'Lovely day for it.', 'My arms are getting longer, I think.',
  'Was that a toucan?', 'Must remember to groom later.', 'This branch is just right.', 'Ooh, a butterfly.', 'I should visit the hot spring.',
  'Was it left at the palm, or right?', 'Shiny pebble! Mine now.', 'The lanterns look cosy.', 'I love the smell of hibiscus.',
  'Is it nap time yet?', 'So many leaves.', 'Who hums like that?', 'The lagoon is calm today.', 'Time for a stretch.',
  'I\'ll just sit here a moment.', 'Mmm, warm sunshine.', 'Fruit, fruit, fruit…', 'Perfect swinging weather.',
  'Funny-looking frog.', 'Hope it doesn\'t rain.', 'Where\'s everyone going?', 'What a view.',
  'Seeing, growing, learning, sharing, keeping.',
  'Leave the branch as you found it.',
  'One more knot and the rug is done.',
  'A good trade: everyone goes home with more.',
  'Share the fruit you find.',
  'The Ledger remembers what we forget.',
];

/** Sleep-talk, for crew members who are asleep (they really are: this edition doesn't wake them). */
export const SLEEP_TALK = ['Bananas…', 'Five more minutes…', 'No, the big mango…', 'Swinging… higher…', 'Mmm… warm spring…', 'Who moved the moon…', 'Ring the bell… later…', 'Shiny pebbles…'];

/**
 * Lines about real events. {name} is filled with the crew member's name. Only ever
 * used right after the matching event really arrives (see chatter.js).
 */
export const EVENT_LINES = {
  job_done: ['{name} just finished a job!', 'Look! {name} is done.', 'Well done, {name}!', '{name} finished. Good work.'],
  job_failed: ['Uh-oh, {name}\'s job didn\'t work out.', 'Poor {name}. That one went wrong.'],
  asking: ['{name} is waiting for your OK.', 'Someone needs you: {name} has a question.'],
  sent: ['The Chief sent {name} off!', 'There goes {name}, on an errand for the Chief.']
};
