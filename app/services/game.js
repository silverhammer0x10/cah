'use strict';

class GameService {
  constructor(log, mongoose, httpStatus, errs) {
    this.log = log;
    this.mongoose = mongoose;
    this.httpStatus = httpStatus;
    this.errs = errs;
  }

  //games/new
  async createGame(body) {
    const Games = this.mongoose.model('Games');
    const Players = this.mongoose.model('Players');
    const BlackCards = this.mongoose.model('BlackCards');
    const WhiteCards = this.mongoose.model('WhiteCards');
    
    let blackCardDeck = await BlackCards.find();
    let whiteCardDeck = await WhiteCards.find();

    let playerOne = new Players({
      name: body.player,
      hand: [],
      points: 0
    });
    playerOne = await playerOne.save();
    
    let newGame = new Games({
      players: [ playerOne._id ],
      blackCards: [],
      whiteCards: [],
      rounds: [],
      czar: -1
    });

    blackCardDeck.forEach(b => {
      newGame.blackCards.push(b._id);
    });

    whiteCardDeck.forEach(w => {
      newGame.whiteCards.push(w._id);
    });

    newGame = await newGame.save();
    newGame = await Games.findOne({_id: newGame._id}).populate('players');

    let returnMe = {
      whiteCardCount: newGame.whiteCards.length,
      blackCardCount: newGame.blackCards.length,
      gameID: newGame._id,
      players: newGame.players
    };

    this.log.info('New game created.');
    this.log.info(returnMe);

    return returnMe;
  }

  //games/join
  async joinGame(body) {
    const Games = this.mongoose.model('Games');
    const Players = this.mongoose.model('Players');
    const Rounds = this.mongoose.model('Rounds');

    let newPlayer = new Players({
      name: body.player,
      hand: [],
      points: 0
    });
    newPlayer = await newPlayer.save();
    
    let game = await Games.findOne({_id: body.gameID});
    game.players.push(newPlayer._id);
    game = await game.save();
    game = await Games.findOne({_id: body.gameID}).populate('players');

    let latestRound = await Rounds.findOne({game: body.gameID, status: "submit"}).populate('blackCard');

    let returnMe = {
      whiteCardCount: game.whiteCards.length,
      blackCardCount: game.blackCards.length,
      gameID: game._id,
      players: game.players,
      rounds: game.rounds,
      latestRound: latestRound
    };

    this.log.info('Player joined game.');
    this.log.info(returnMe);

    return returnMe;
  }

  //games/startRound
  async startRound(body) {
    const Games = this.mongoose.model('Games');
    const Rounds = this.mongoose.model('Rounds');
    const Players = this.mongoose.model('Players');
    const BlackCards = this.mongoose.model('BlackCards');
    const handSize = 8;

    let game = await Games.findOne({_id: body.gameID});
    if(game.czar === game.players.length-1){
      game.czar = 0;
    } else {
      game.czar++;
    }
    let round = new Rounds({
      players: game.players,
      status: 'submit',
      game: game._id,
      blackCard: game.blackCards[Math.floor(Math.random()*game.blackCards.length)],
      candidateCards: [],
      czar: game.players[game.czar]
    });

    round = await round.save();
    game.rounds.push(round);
    game.blackCards = game.blackCards.filter(e => e._id !== round.blackCard);

    //Give each player (handSize) white cards
    round.players.forEach(async p => {
      let player = await Players.findOne({_id: p});
      while(player.hand.length < handSize){
        let whiteCard = game.whiteCards[Math.floor(Math.random()*game.whiteCards.length)];
        player.hand.push(whiteCard);
        game.whiteCards = game.whiteCards.filter(e => e !== whiteCard);
      }
      player = await player.save();
    });
    
    game = await game.save();
    round = Rounds.findOne({_id: round._id}).populate('blackCard').populate('players');

    return round;
  }

  //games/submitWhiteCard
  async submitWhiteCard (body){
    const Games = this.mongoose.model('Games');
    const Rounds = this.mongoose.model('Rounds');
    const Players = this.mongoose.model('Players');
    const WhiteCards = this.mongoose.model('WhiteCards');

    let round = await Rounds.findOne({_id: body.roundID});
    if(round.status !== 'submit'){
      this.log.info('All White Cards submitted');
      return 'All White Cards submitted';
    }

    if(round.candidateCards.some(card => card.player == body.playerID)){
      this.log.info('Already submitted a card');
      return 'Already submitted a card';
    }

    let candidateCard = await WhiteCards.findOne({_id:body.whiteCard});

    round.candidateCards.push({
      player: body.playerID,
      cards: [candidateCard.text]
    });

    if(round.candidateCards.length === round.players.length-1){
      round.status = 'select';
    }
    round = await round.save();

    let game = await Games.findOne({_id: round.game});

    let player = await Players.findOne({_id: body.playerID});

    player.hand = player.hand.filter(o => o != body.whiteCard);
    player = await player.save();

    this.log.info('White card submitted.');

    round = await Rounds.findOne({_id: body.roundID}).populate('blackCard').populate('players');
    return round;
  }
  
  //games/selectCandidateCard
  async selectCandidateCard (body){
    const Rounds = this.mongoose.model('Rounds');
    const Players = this.mongoose.model('Players');

    let round = await Rounds.findOne({_id: body.roundID}).populate('players');
    round.players.forEach(async player => {
      if(player._id == body.player){
        player.points++;
        let updatePlayer = await Players.findOne({_id: body.player}).populate('hand');
        updatePlayer.points++;
        updatePlayer = updatePlayer.save();
      }
    });
    round.candidateCards.forEach(candidate => {
      if(candidate.player == body.player){
        candidate.winner = true;
      }
    });
    round.status = 'closed';
    round = await round.save();

    this.log.info('Winning Card Selected.');
    return round;
  }

  //games/getHand
  async getHand (body){
    const Players = this.mongoose.model('Players');

    let player = await Players.findOne({_id: body.playerID}).populate('hand');
    this.log.info(player);

    return player;
  }

  //games/getRound
  async getRound (body){
    const Rounds = this.mongoose.model('Rounds');

    let round = await Rounds.findOne({_id: body.roundID}).populate('blackCard').populate('players');

    return round;
  }

  //games/getLatestRound
  async getLatestRound (body){
    const Rounds = this.mongoose.model('Rounds');
    const Games = this.mongoose.model('Games');
    let game = await Games.findOne({_id: body.gameID});
    let latestRoundId = game.rounds[game.rounds.length - 1];
    let round = await Rounds.findOne({ _id: latestRoundId }).populate('blackCard').populate('players');

    /*
    User.findOne({$or: [
        {email: req.body.email},
        {phone: req.body.phone}
    ]}).exec(function(err, user){
        if (user) {} //user already exists with email AND/OR phone.
        else {} //no users with that email NOR phone exist.
    });
    */

    return round;
  }

  async parseGame() {
    const https = require('https');

    https.get('https://cards-against-humanity-api.herokuapp.com/sets', (resp) => {
      let data = '';

      // A chunk of data has been recieved.
      resp.on('data', (chunk) => {
        data += chunk;
      });

      // The whole response has been received. Print out the result.
      resp.on('end', () => {
        const Sets = this.mongoose.model('Sets'); 
        //this.log.info(data);
        JSON.parse(data).forEach(async s => {
          const exists = await Sets.findOne({name: s.setName});
          if(exists){
            this.log.info(exists);
          } else {
            let newSet = new Sets({
              name: s.setName
            });
            newSet = await newSet.save();
            this.log.info("New set found. Added "+s.setName+".");
          }
        });
      });

    }).on("error", (err) => {
      this.log.info("Error: " + err.message);
    });

    return "Sets added";
  }

  async parseCards() {
    const https = require('https');
    const Sets = this.mongoose.model('Sets'); 
    let allSets = await Sets.find();
    allSets.forEach(s => {
      https.get('https://cards-against-humanity-api.herokuapp.com/sets/'+s.name, (resp) => {
        let data = '';

        // A chunk of data has been recieved.
        resp.on('data', (chunk) => {
          data += chunk;
        });

        // The whole response has been received. Print out the result.
        resp.on('end', () => {
          const BlackCards = this.mongoose.model('BlackCards');
          const WhiteCards = this.mongoose.model('WhiteCards');
          let { blackCards, whiteCards } = JSON.parse(data);
          
          blackCards.forEach(async b => {
            const exists = await BlackCards.findOne({set: s._id, text: b.text});
            if(exists){
              this.log.info("Black Card exists");
            } else {
              this.log.info("New Black Card found. Added "+b.text+".");
              let blackCard = new BlackCards({
                set: s._id,
                text: b.text,
                pick: b.pick
              });
              blackCard = await blackCard.save();
            }
          });

          whiteCards.forEach(async w => {
            const exists = await WhiteCards.findOne({set: s._id, text: w});
            if(exists){
              this.log.info("White Card exists");
            } else {
              this.log.info("New White Card found. Added "+w+".");
              let whiteCard = new WhiteCards({
                set: s._id,
                text: w
              });
              whiteCard = await whiteCard.save();
            }
          });
        });

      }).on("error", (err) => {
        this.log.info("Error: " + err.message);
      });
    });

    return "Let's add some cards.";
  }
}

module.exports = GameService;